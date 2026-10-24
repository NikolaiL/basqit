import { deployment } from "../packs/usePacks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import { basketAbi } from "~~/services/baskets/abi";
import { valuePerShare } from "~~/services/baskets/value";
import { packsClient, testnetAssets } from "~~/services/packs/testnet";

type Part = { token: Address; unitsPerShare: bigint };
const factory = { address: deployment.factory, abi: deployment.abis.factory as Abi } as const;
const shop = { address: deployment.swapAdapter, abi: deployment.abis.swapAdapter as Abi } as const;

/** Every basket of the factory with its parts, live value per share, rules and `address`'s balance. */
export function useBasketRows(address?: Address) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["packs-baskets", deployment.factory, address],
    staleTime: 15_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [[list, feesOn], { usdg }] = await Promise.all([
        packsClient.multicall({
          allowFailure: false,
          contracts: [
            { ...factory, functionName: "allBaskets" },
            { ...factory, functionName: "feesEnabled" },
          ],
        }) as Promise<[Address[], boolean]>,
        queryClient.fetchQuery({
          queryKey: ["packs-assets", deployment.factory],
          staleTime: 60_000,
          queryFn: testnetAssets,
        }),
      ]);
      const rows = await Promise.all(
        list.map(async basket => {
          const b = { address: basket, abi: deployment.abis.basket as Abi } as const;
          const [name, symbol, parts, supply, fee, balance = 0n] = (await packsClient.multicall({
            allowFailure: false,
            contracts: [
              { ...b, functionName: "name", args: [] },
              { ...b, functionName: "symbol", args: [] },
              { ...b, functionName: "components", args: [] },
              { ...b, functionName: "totalSupply", args: [] },
              { ...factory, functionName: "creatorFee", args: [basket] },
              ...(address ? [{ ...b, functionName: "balanceOf", args: [address] }] : []),
            ],
          })) as [string, string, Part[], bigint, readonly [Address, number], bigint?];
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
            rules: { manager, noticeSeconds: Number(notice), maxSlippageBps: Number(slippage) },
            readyAt: Number(readyAt),
            lastRebalanceAt: Number(lastRebalanceAt),
            change: pending ? { sells: pending[0].map(s => s.token), buys: pending[1].map(b => b.token) } : undefined,
          };
        }),
      );
      const tokens = [...new Set(rows.flatMap(row => row.parts.map(part => part.token.toLowerCase() as Address)))];
      const prices = (await packsClient.multicall({
        allowFailure: false,
        contracts: tokens.map(token => ({ ...shop, functionName: "priceUsdG", args: [token] })),
      })) as bigint[];
      const pricesByToken = Object.fromEntries(tokens.map((token, i) => [token, prices[i]]));
      // Chain time, as the contract judges the notice window by it; the banner counts down on each refresh.
      const { timestamp } = await packsClient.getBlock();
      return {
        rows: rows.map(row => ({
          ...row,
          // Unknown prices stay unavailable; the trade dialog refuses to price them.
          perShare: valuePerShare(row.parts, pricesByToken, usdg) ?? 0n,
        })),
        feesOn,
        checkedAt: Number(timestamp),
      };
    },
  });
}
