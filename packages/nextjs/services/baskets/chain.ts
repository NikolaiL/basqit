import { adapterEvents, basketAbi, basketEvent, factoryEvents, priceAbi } from "./abi";
import { blockTimes } from "./blockTime";
import type { Component } from "./value";
import type { Address } from "viem";
import { packsClient, packsTestnet } from "~~/services/packs/testnet";

/** One multicall for everything a card, the details header and the cron need about a basket. */
export async function readBasketState(basket: Address) {
  const b = { address: basket, abi: basketAbi } as const;
  const [components, supply, manager, notice, slippage, readyAt] = await packsClient.multicall({
    allowFailure: false,
    contracts: [
      { ...b, functionName: "components" },
      { ...b, functionName: "totalSupply" },
      { ...b, functionName: "manager" },
      { ...b, functionName: "noticePeriod" },
      { ...b, functionName: "maxSlippageBps" },
      { ...b, functionName: "rebalanceReadyAt" },
    ],
  });
  return {
    components: components as readonly Component[] as Component[],
    supply,
    manager,
    noticeSeconds: Number(notice),
    maxSlippageBps: Number(slippage),
    readyAt: Number(readyAt),
  };
}

/** Reference prices (the testnet swap adapter) for `tokens`, keyed by lowercase address. */
export async function currentPrices(tokens: Address[]) {
  const prices = await packsClient.multicall({
    allowFailure: false,
    contracts: tokens.map(token => ({
      address: packsTestnet!.swapAdapter,
      abi: priceAbi,
      functionName: "priceUsdG" as const,
      args: [token] as const,
    })),
  });
  return Object.fromEntries(tokens.map((token, i) => [token.toLowerCase(), prices[i]])) as Record<string, bigint>;
}

/** A log's block time; the block cache lives as long as the server instance. */
export const timeOf = blockTimes(blockNumber => packsClient.getBlock({ blockNumber }));

/** Orders events in the same second: block number, then log index. */
const seqOf = (log: { blockNumber: bigint | null; logIndex: number | null }) =>
  Number(log.blockNumber) * 100_000 + (log.logIndex ?? 0);

/** Creation and rebalances of one basket: cheap, two filtered log reads. `null` when it is not a basket of this
 * factory. */
export async function readTimeline(basket: Address) {
  const fromBlock = BigInt(packsTestnet!.deployBlock);
  const [created, rebalanced] = await Promise.all([
    packsClient.getLogs({ address: packsTestnet!.factory, event: factoryEvents[0], args: { basket }, fromBlock }),
    packsClient.getLogs({ address: basket, event: basketEvent("Rebalanced"), fromBlock }),
  ]);
  if (!created.length) return null;
  return {
    createdAt: await timeOf(created[0]),
    createdSeq: seqOf(created[0]),
    start: [...created[0].args.components!],
    rebalances: await Promise.all(
      rebalanced.map(async l => ({ at: await timeOf(l), seq: seqOf(l), after: [...l.args.after_!] })),
    ),
  };
}

/** Prices of every token the basket ever held, and its supply changes: the expensive part, read only to rebuild. */
export async function readPricesAndSupply(basket: Address, tokens: Address[]) {
  const fromBlock = BigInt(packsTestnet!.deployBlock);
  const zero = "0x0000000000000000000000000000000000000000";
  const transfer = basketEvent("Transfer");
  const [priced, mints, burns] = await Promise.all([
    packsClient.getLogs({
      address: packsTestnet!.swapAdapter,
      event: adapterEvents[0],
      args: { token: tokens },
      fromBlock,
    }),
    packsClient.getLogs({ address: basket, event: transfer, args: { from: zero }, fromBlock }),
    packsClient.getLogs({ address: basket, event: transfer, args: { to: zero }, fromBlock }),
  ]);
  return {
    prices: await Promise.all(
      priced.map(async l => ({ at: await timeOf(l), seq: seqOf(l), token: l.args.token!, price: l.args.price! })),
    ),
    supply: [
      ...(await Promise.all(mints.map(async l => ({ at: await timeOf(l), delta: l.args.value! })))),
      ...(await Promise.all(burns.map(async l => ({ at: await timeOf(l), delta: -l.args.value! })))),
    ],
  };
}

/** Every token a basket has held, from its timeline. */
export const tokensEverHeld = (timeline: { start: Component[]; rebalances: { after: Component[] }[] }) => [
  ...new Set([timeline.start, ...timeline.rebalances.map(r => r.after)].flat().map(c => c.token as Address)),
];
