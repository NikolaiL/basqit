"use client";

import { deadlineIn, deployment, ensureAllowance, usePacksWrite, useTokens } from "./usePacks";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { packsClient, testnetAssets } from "~~/services/packs/testnet";

type Part = { token: Address; unitsPerShare: bigint };

const ONE = 10n ** 18n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Buying and selling basket shares through the routers, shared by the basket cards and the details page. */
export function useBasketTrades() {
  const { address } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const tickers = (parts: Part[]) => parts.map(part => tokens.data?.[part.token.toLowerCase()]?.ticker ?? "");
  const shop = { address: deployment.swapAdapter, abi: deployment.abis.swapAdapter } as const;
  const priceOf = (token: Address) =>
    packsClient.readContract({ ...shop, functionName: "priceUsdG", args: [token] }) as Promise<bigint>;

  /** The swap legs that buy `amount` shares, and what they cost with the creator fee. */
  const buyLegs = async (basket: Address, amount: bigint, feeBps: bigint) => {
    const b = { address: basket, abi: deployment.abis.basket } as const;
    const [parts, needed] = (await Promise.all([
      packsClient.readContract({ ...b, functionName: "components" }),
      packsClient.readContract({ ...b, functionName: "quoteMint", args: [amount] }),
    ])) as [Part[], bigint[]];
    const legs = await Promise.all(
      parts.map(async (part, i) => ({
        adapter: deployment.swapAdapter,
        maxAmountIn: (await packsClient.readContract({
          ...shop,
          functionName: "quote",
          args: [part.token, needed[i]],
        })) as bigint,
        routeData: "0x" as const,
      })),
    );
    const spent = legs.reduce((sum, leg) => sum + leg.maxAmountIn, 0n);
    return { legs, parts, cost: spent + ceilDiv(spent * feeBps, 10_000n) };
  };

  /**
   * Spends up to `budget` tUSDG on as many shares as it buys, to 6 decimals. Each component is bought exactly
   * through the adapter; the router refunds whatever the purchase does not use.
   */
  const buy = async (basket: Address, budget: bigint, perShare: bigint, feeBps: bigint) => {
    const step = 10n ** 12n;
    let amount = ((budget * 10_000n * ONE) / ((10_000n + feeBps) * perShare) / step) * step;
    let quote = await buyLegs(basket, amount, feeBps);
    // Per-component rounding can cost a little more than the estimate; shrink to fit, at most a few times.
    for (let tries = 0; quote.cost > budget && tries < 3; tries++) {
      amount = ((amount * budget) / quote.cost / step) * step;
      quote = await buyLegs(basket, amount, feeBps);
    }
    if (amount === 0n || quote.cost > budget) throw new Error("That amount buys less than 0.000001 of a share.");
    const { legs, parts } = quote;
    const { usdg } = await testnetAssets();
    await ensureAllowance(write, address!, usdg, deployment.purchaseRouter, budget);
    return write(
      {
        address: deployment.purchaseRouter,
        abi: deployment.abis.purchaseRouter,
        functionName: "buyBasket",
        args: [basket, amount, budget, legs, address, deadlineIn(20)],
      },
      { celebrate: tickers(parts) },
    );
  };

  /** Sells `amount` shares: redeems in kind and sells each component, with the fee taken from what comes back. */
  const sell = async (basket: Address, amount: bigint, feeBps: bigint) => {
    const b = { address: basket, abi: deployment.abis.basket } as const;
    const [parts, out] = (await Promise.all([
      packsClient.readContract({ ...b, functionName: "components" }),
      packsClient.readContract({ ...b, functionName: "quoteRedeem", args: [amount] }),
    ])) as [Part[], bigint[]];
    const legs = await Promise.all(
      parts.map(async (part, i) => ({
        adapter: deployment.swapAdapter,
        minAmountOut: (out[i] * (await priceOf(part.token))) / ONE,
        routeData: "0x" as const,
      })),
    );
    const received = legs.reduce((sum, leg) => sum + leg.minAmountOut, 0n);
    const minUsdGOut = received - ceilDiv(received * feeBps, 10_000n);
    await ensureAllowance(write, address!, basket, deployment.sellRouter, amount);
    return write({
      address: deployment.sellRouter,
      abi: deployment.abis.sellRouter,
      functionName: "sellBasket",
      args: [basket, amount, minUsdGOut, legs, address, deadlineIn(20)],
    });
  };

  return { buy, sell };
}
