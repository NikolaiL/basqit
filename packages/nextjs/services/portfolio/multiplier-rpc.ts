import { unstable_cache } from "next/cache";
import type { MultiplierTransition } from "./multiplier-history";
import { decodeEventLog, formatUnits, parseAbiItem } from "viem";
import { atlasClient } from "~~/services/atlas/client";

const updateTopic = "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
const cancelTopic = "0x883856335ba5f60c18b9817c4505d3c7d3f6223dcf39516b30c508c46a5e1cad";
const update = parseAbiItem(
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
);

export const readMultiplierHistory = unstable_cache(
  async (addresses: `0x${string}`[]) => {
    const head = await atlasClient.getBlock();
    // ponytail: cached genesis scan suits the sparse current feed; use incremental indexing if RPC range limits or volume grow.
    const logs = await atlasClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: addresses,
          fromBlock: "0x0",
          toBlock: `0x${head.number.toString(16)}`,
          topics: [[updateTopic, cancelTopic]],
        },
      ],
    });
    const transitions: MultiplierTransition[] = [];
    const ordered = logs
      .filter(log => !log.removed)
      .sort(
        (a, b) =>
          Number(BigInt(a.blockNumber!) - BigInt(b.blockNumber!)) || Number(BigInt(a.logIndex!) - BigInt(b.logIndex!)),
      );
    const timestamps = new Map<string, bigint>();
    for (const log of ordered) {
      if (log.topics[0] !== updateTopic || !log.blockNumber || !log.transactionHash || !log.logIndex) continue;
      const { args } = decodeEventLog({ abi: [update], data: log.data, topics: log.topics });
      if (args.effectiveAtTimestamp > head.timestamp || args.oldMultiplier <= 0n || args.newMultiplier <= 0n) continue;
      // A replacement or cancellation before activation invalidates this schedule.
      let superseded = false;
      for (const later of ordered.slice(ordered.indexOf(log) + 1)) {
        if (later.address.toLowerCase() !== log.address.toLowerCase() || !later.blockNumber) continue;
        let time = timestamps.get(later.blockNumber);
        if (time === undefined) {
          time = (await atlasClient.getBlock({ blockNumber: BigInt(later.blockNumber) })).timestamp;
          timestamps.set(later.blockNumber, time);
        }
        if (time <= args.effectiveAtTimestamp) superseded = true;
        break;
      }
      if (superseded) continue;
      transitions.push({
        address: log.address.toLowerCase(),
        before: formatUnits(args.oldMultiplier, 18),
        after: formatUnits(args.newMultiplier, 18),
        effectiveAt: new Date(Number(args.effectiveAtTimestamp) * 1000).toISOString(),
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString(),
        logIndex: Number(BigInt(log.logIndex)),
      });
    }
    return transitions;
  },
  ["stock-multiplier-history-v1"],
  { revalidate: 300 },
);
