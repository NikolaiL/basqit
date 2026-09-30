import { unstable_cache } from "next/cache";
import type { MultiplierTransition } from "./multiplier-history";
import { decodeEventLog, formatUnits, parseAbiItem } from "viem";
import { atlasClient } from "~~/services/atlas/client";

const updateTopic = "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
const cancelTopic = "0x883856335ba5f60c18b9817c4505d3c7d3f6223dcf39516b30c508c46a5e1cad";
const update = parseAbiItem(
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
);

const LOG_WINDOW = 10_000_000n;
const CONCURRENCY = 4;
const DAY = 86_400;

/** One scan per token: blocks around its events' dates, `fromDay`/`toDay` in days since the epoch. */
export type HistoryRange = { address: `0x${string}`; fromDay: number; toDay: number };

const getLogs = async ({
  address,
  topic,
  from,
  to,
}: {
  address: `0x${string}`;
  topic: string;
  from: bigint;
  to: bigint;
}) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await atlasClient.request({
        method: "eth_getLogs",
        params: [
          {
            address,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
            topics: [topic as `0x${string}`],
          },
        ],
      });
    } catch (error) {
      // The public RPC rate-limits bursts; back off and retry a few times before giving up.
      if (attempt >= 4 || !String((error as Error)?.message).includes("Too Many Requests")) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
};

/** One decoded log: a scheduled update, or a cancellation (no `update`). */
type Entry = {
  address: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  blockTimestamp?: bigint;
  update?: { oldMultiplier: bigint; newMultiplier: bigint; effectiveAt: bigint };
};

/** Entries scanned from the RPC around each token's events, within the RPC's eth_getLogs limits. */
async function fromRpc(ranges: HistoryRange[], head: { number: bigint; timestamp: bigint }): Promise<Entry[]> {
  // Block height from a timestamp, by the chain's average block rate over the last million blocks, with margin.
  const sample = await atlasClient.getBlock({ blockNumber: head.number - 1_000_000n });
  const perSecond = 1_000_000 / Number(head.timestamp - sample.timestamp);
  const blockAt = (seconds: number, margin: number) => {
    const back = Math.ceil((Number(head.timestamp) - seconds) * perSecond * margin);
    const block = head.number - BigInt(Math.max(back, 0));
    return block < 0n ? 0n : block > head.number ? head.number : block;
  };
  // The RPC caps eth_getLogs at 10M blocks for one address and one topic (100k with several addresses or
  // topics), so each (token, topic) is scanned only around its events, in 10M-block windows.
  const jobs = ranges.flatMap(({ address, fromDay, toDay }) => {
    const first = blockAt(fromDay * DAY, 1.05);
    const last = blockAt((toDay + 1) * DAY, 0.95);
    const windows: [bigint, bigint][] = [];
    for (let from = first; from <= last; from += LOG_WINDOW) {
      const to = from + LOG_WINDOW - 1n;
      windows.push([from, to > last ? last : to]);
    }
    return [updateTopic, cancelTopic].flatMap(topic => windows.map(([from, to]) => ({ address, topic, from, to })));
  });
  const logs: Awaited<ReturnType<typeof getLogs>> = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = await Promise.all(jobs.slice(i, i + CONCURRENCY).map(getLogs));
    for (const found of batch) logs.push(...found);
  }
  return toEntries(logs);
}

type RpcLog = Awaited<ReturnType<typeof getLogs>>[number];

function toEntries(logs: RpcLog[]): Entry[] {
  return logs
    .filter(log => !log.removed && log.blockNumber && log.transactionHash && log.logIndex)
    .map(log => ({
      address: log.address.toLowerCase(),
      blockNumber: BigInt(log.blockNumber!),
      logIndex: Number(BigInt(log.logIndex!)),
      transactionHash: log.transactionHash!,
      update:
        log.topics[0] === updateTopic
          ? (() => {
              const { args } = decodeEventLog({ abi: [update], data: log.data, topics: log.topics });
              return {
                oldMultiplier: args.oldMultiplier,
                newMultiplier: args.newMultiplier,
                effectiveAt: args.effectiveAtTimestamp,
              };
            })()
          : undefined,
    }));
}

/**
 * The whole history in one request through Alchemy, which serves eth_getLogs for these two events over every block
 * (51 logs chain-wide on 30 Sept 2026, under a second). Filtered here to the tokens the page shows.
 */
async function fromAlchemy(ranges: HistoryRange[]): Promise<Entry[] | null> {
  const key = process.env.ALCHEMY_MULTICHAIN_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(`https://robinhood-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [{ fromBlock: "0x0", toBlock: "latest", topics: [[updateTopic, cancelTopic]] }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await response.json()) as { result?: RpcLog[] };
    if (!Array.isArray(body.result)) return null;
    const wanted = new Set(ranges.map(range => range.address.toLowerCase()));
    return toEntries(body.result.filter(log => wanted.has(log.address.toLowerCase())));
  } catch {
    return null;
  }
}

export const readMultiplierHistory = unstable_cache(
  async (ranges: HistoryRange[]) => {
    const head = await atlasClient.getBlock();
    const entries = (await fromAlchemy(ranges)) ?? (await fromRpc(ranges, head));
    const seen = new Set<string>();
    const ordered = entries
      .filter(entry => {
        const key = `${entry.transactionHash}:${entry.logIndex}`;
        return !seen.has(key) && !!seen.add(key);
      })
      .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
    const timeOf = async (entry: Entry) =>
      (entry.blockTimestamp ??= (await atlasClient.getBlock({ blockNumber: entry.blockNumber })).timestamp);
    const transitions: MultiplierTransition[] = [];
    for (const [i, entry] of ordered.entries()) {
      const change = entry.update;
      if (!change || change.effectiveAt > head.timestamp || change.oldMultiplier <= 0n || change.newMultiplier <= 0n)
        continue;
      // A replacement or cancellation before activation invalidates this schedule.
      const later = ordered.slice(i + 1).find(next => next.address === entry.address);
      if (later && (await timeOf(later)) <= change.effectiveAt) continue;
      transitions.push({
        address: entry.address,
        before: formatUnits(change.oldMultiplier, 18),
        after: formatUnits(change.newMultiplier, 18),
        effectiveAt: new Date(Number(change.effectiveAt) * 1000).toISOString(),
        transactionHash: entry.transactionHash,
        blockNumber: entry.blockNumber.toString(),
        logIndex: entry.logIndex,
      });
    }
    return transitions;
  },
  ["stock-multiplier-history-v5"],
  { revalidate: 1800 },
);
