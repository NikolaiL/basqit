import { deployment } from "../packs/usePacks";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { basketAbi } from "~~/services/baskets/abi";
import { valuePerShare } from "~~/services/baskets/value";
import { packsClient, testnetAssets } from "~~/services/packs/testnet";

type Part = { token: Address; unitsPerShare: bigint };
const factory = { address: deployment.factory, abi: deployment.abis.factory } as const;
const shop = { address: deployment.swapAdapter, abi: deployment.abis.swapAdapter } as const;
const priceOf = (token: Address) =>
  packsClient.readContract({ ...shop, functionName: "priceUsdG", args: [token] }) as Promise<bigint>;

/** Every basket of the factory with its parts, live value per share, rules and `address`'s balance. */
export function useBasketRows(address?: Address) {
  return useQuery({
    queryKey: ["packs-baskets", deployment.factory, address],
    refetchInterval: 15_000,
    queryFn: async () => {
      const [list, feesOn] = (await Promise.all([
        packsClient.readContract({ ...factory, functionName: "allBaskets" }),
        packsClient.readContract({ ...factory, functionName: "feesEnabled" }),
      ])) as [Address[], boolean];
      const rows = await Promise.all(
        list.map(async basket => {
          const b = { address: basket, abi: deployment.abis.basket } as const;
          const [name, symbol, parts, supply, balance, fee] = await Promise.all([
            packsClient.readContract({ ...b, functionName: "name" }) as Promise<string>,
            packsClient.readContract({ ...b, functionName: "symbol" }) as Promise<string>,
            packsClient.readContract({ ...b, functionName: "components" }) as Promise<Part[]>,
            packsClient.readContract({ ...b, functionName: "totalSupply" }) as Promise<bigint>,
            address
              ? (packsClient.readContract({ ...b, functionName: "balanceOf", args: [address] }) as Promise<bigint>)
              : Promise.resolve(0n),
            packsClient.readContract({ ...factory, functionName: "creatorFee", args: [basket] }) as Promise<
              readonly [Address, number]
            >,
          ]);
          const { usdg } = await testnetAssets();
          const prices = await Promise.all(parts.map(part => priceOf(part.token)));
          // 0 when a price is missing: shown as "…", and the buy dialog refuses to price it.
          const perShare =
            valuePerShare(
              parts,
              Object.fromEntries(parts.map((part, i) => [part.token.toLowerCase(), prices[i]])),
              usdg,
            ) ?? 0n;
          const rules = { address: basket, abi: basketAbi } as const;
          const [manager, notice, slippage, readyAt, lastRebalanceAt] = await packsClient.multicall({
            allowFailure: false,
            contracts: [
              { ...rules, functionName: "manager" },
              { ...rules, functionName: "noticePeriod" },
              { ...rules, functionName: "maxSlippageBps" },
              { ...rules, functionName: "rebalanceReadyAt" },
              { ...rules, functionName: "lastRebalanceAt" },
            ],
          });
          // What an announced change does, for the banner; only read while one is pending.
          const pending = readyAt
            ? await packsClient.readContract({ ...rules, functionName: "pendingRebalance" })
            : undefined;
          return {
            basket,
            name,
            symbol,
            parts,
            supply,
            balance,
            creator: fee[0],
            feeBps: BigInt(fee[1]),
            perShare,
            rules: { manager, noticeSeconds: Number(notice), maxSlippageBps: Number(slippage) },
            readyAt: Number(readyAt),
            lastRebalanceAt: Number(lastRebalanceAt),
            change: pending ? { sells: pending[0].map(s => s.token), buys: pending[1].map(b => b.token) } : undefined,
          };
        }),
      );
      // Chain time, as the contract judges the notice window by it; the banner counts down on each refresh.
      const { timestamp } = await packsClient.getBlock();
      return { rows, feesOn, checkedAt: Number(timestamp) };
    },
  });
}
