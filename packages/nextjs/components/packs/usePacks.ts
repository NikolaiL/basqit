"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Abi, type Address, erc20Abi, formatUnits } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { useTransactor } from "~~/hooks/scaffold-eth";
import {
  type PacksDeployment,
  packsClient,
  packsTestnet,
  robinhoodTestnet,
  testnetAssets,
} from "~~/services/packs/testnet";

export const deployment = packsTestnet as PacksDeployment;

export type TokenInfo = { address: Address; symbol: string; ticker: string; decimals: number };

/** Symbols and decimals of the test tokens; the ticker drops the testnet "t" prefix for logos. */
export function useTokens() {
  return useQuery({
    queryKey: ["packs-tokens", packsTestnet?.factory],
    enabled: !!packsTestnet,
    staleTime: Infinity,
    queryFn: async () => {
      const { usdg, stocks } = await testnetAssets();
      const addresses = [usdg, ...stocks];
      const results = await packsClient.multicall({
        contracts: addresses.flatMap(address => [
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "decimals" },
        ]),
        allowFailure: false,
      });
      return Object.fromEntries(
        addresses.map((address, i) => {
          const symbol = results[i * 2] as string;
          return [
            address.toLowerCase(),
            { address, symbol, ticker: symbol.replace(/^t/, ""), decimals: results[i * 2 + 1] as number },
          ];
        }),
      ) as Record<string, TokenInfo>;
    },
  });
}

/**
 * USD per whole token at the live mainnet Stock Token price (mid of token bid and ask) for each ticker.
 * Test tokens have no value; this shows what the same amount of the real Stock Token is worth.
 */
export function useUsdPrices(tickers: string[]) {
  const unique = [...new Set(tickers.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["packs-usd", unique.join(",")],
    enabled: unique.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map(async ticker => {
          const response = await fetch(`/api/stocks/details?symbol=${encodeURIComponent(ticker)}`);
          if (!response.ok) return [ticker, undefined] as const;
          const quote = await response.json();
          const mid = (Number(quote.tokenBid) + Number(quote.tokenAsk)) / 2;
          return [ticker, quote.currency === "USD" && mid > 0 ? mid : undefined] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, number | undefined>;
    },
  });
}

export const formatUsd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 3 : 2 });

/** A trade deadline `minutes` from now, so a transaction stuck in a wallet cannot fill at an old price. */
export const deadlineIn = (minutes: number) => BigInt(Math.floor(Date.now() / 1000) + minutes * 60);

export const formatToken = (amount: bigint, decimals: number) => {
  const value = Number(formatUnits(amount, decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 4 : 2 });
};

/** Writes on Robinhood Chain testnet, then waits for the receipt and refreshes every Packs read. */
export function usePacksWrite() {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient({ chainId: robinhoodTestnet.id });
  const transact = useTransactor(wallet);
  const client = useQueryClient();
  return async (call: {
    address: Address;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: unknown[];
    value?: bigint;
  }) => {
    if (!wallet || !address) throw new Error("Connect a wallet on Robinhood Chain testnet.");
    const request = {
      account: address,
      address: call.address,
      abi: call.abi as Abi,
      functionName: call.functionName,
      args: call.args ?? [],
      value: call.value,
    };
    // Estimate on our own RPC and hand the wallet a gas limit. A wallet whose node has not yet seen the approval
    // just sent otherwise fails its own estimate and shows an absurd gas limit; a call that would revert fails
    // here with a readable error instead.
    const gas = await packsClient.estimateContractGas(request);
    const hash = await transact(() =>
      wallet.writeContract({ ...request, chain: robinhoodTestnet, gas: (gas * 13n) / 10n }),
    );
    if (hash) await packsClient.waitForTransactionReceipt({ hash });
    await client.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("packs") });
    return hash;
  };
}

/** Approves `spender` for exactly what is needed when the allowance is short. */
export async function ensureAllowance(
  write: ReturnType<typeof usePacksWrite>,
  owner: Address,
  token: Address,
  spender: Address,
  amount: bigint,
) {
  const allowance = await packsClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance < amount)
    await write({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}
