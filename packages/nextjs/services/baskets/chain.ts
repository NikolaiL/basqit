import { basketAbi, priceAbi } from "./abi";
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
