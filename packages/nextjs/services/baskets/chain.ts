import { adapterEvents, basketAbi, basketEvent, factoryEvents, priceAbi } from "./abi";
import type { HistoryEvents } from "./history";
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

/** A log's block time: the testnet RPC includes it on every log; older nodes need the block. */
export const timeOf = async (log: { blockTimestamp?: bigint | null; blockNumber: bigint | null }) =>
  log.blockTimestamp != null
    ? Number(log.blockTimestamp)
    : Number((await packsClient.getBlock({ blockNumber: log.blockNumber! })).timestamp);

/** Creation, rebalances, prices and supply changes since the factory's deploy, for one basket; `null` when the
 * address is not a basket of this factory. The testnet RPC returns every log of this deployment in one call; chunk by
 * block range if that ever stops holding. */
export async function readHistoryEvents(basket: Address): Promise<HistoryEvents | null> {
  const fromBlock = BigInt(packsTestnet!.deployBlock);
  const zero = "0x0000000000000000000000000000000000000000";
  const transfer = basketEvent("Transfer");
  const [created, rebalanced, priced, mints, burns] = await Promise.all([
    packsClient.getLogs({ address: packsTestnet!.factory, event: factoryEvents[0], args: { basket }, fromBlock }),
    packsClient.getLogs({ address: basket, event: basketEvent("Rebalanced"), fromBlock }),
    packsClient.getLogs({ address: packsTestnet!.swapAdapter, event: adapterEvents[0], fromBlock }),
    packsClient.getLogs({ address: basket, event: transfer, args: { from: zero }, fromBlock }),
    packsClient.getLogs({ address: basket, event: transfer, args: { to: zero }, fromBlock }),
  ]);
  if (!created.length) return null;
  return {
    createdAt: await timeOf(created[0]),
    start: [...created[0].args.components!],
    rebalances: await Promise.all(rebalanced.map(async l => ({ at: await timeOf(l), after: [...l.args.after_!] }))),
    prices: await Promise.all(
      priced.map(async l => ({ at: await timeOf(l), token: l.args.token!, price: l.args.price! })),
    ),
    supply: [
      ...(await Promise.all(mints.map(async l => ({ at: await timeOf(l), delta: l.args.value! })))),
      ...(await Promise.all(burns.map(async l => ({ at: await timeOf(l), delta: -l.args.value! })))),
    ],
  };
}
