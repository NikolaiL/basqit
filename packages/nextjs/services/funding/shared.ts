import { arbitrum, base, mainnet, optimism } from "viem/chains";

export const fundingChains = [mainnet, base, arbitrum, optimism] as const;
export const networkIds: Record<string, number> = {
  "eth-mainnet": 1,
  "base-mainnet": 8453,
  "arb-mainnet": 42161,
  "opt-mainnet": 10,
};
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export type FundingToken = {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  balance: string;
  usd: number;
};
export type FundingQuote = {
  wallet: `0x${string}`;
  chainId: number;
  token: `0x${string}`;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  expiresAt: number;
  quoteId: string;
  spender: `0x${string}` | null;
  provider: string;
  seconds: number;
  fee: { amount: string; token: string } | null;
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string };
};
export type FundingStatus = {
  status: string;
  zid?: string;
  failure?: {
    status: string;
    reason?: string;
    recovery?: { chainId: number; token: string; settledAmount?: string; amount?: string };
  };
};
export type FundingTransfer = {
  wallet: string;
  chainId: number;
  quoteId: string;
  hash?: `0x${string}`;
  createdAt: number;
};
export function terminalStatus(data?: FundingStatus) {
  return (
    data?.status === "bridge_filled" ||
    data?.status === "origin_tx_reverted" ||
    (data?.status === "bridge_failed" &&
      ["refund_succeeded", "no_actions_required", "failed"].includes(data.failure?.status ?? ""))
  );
}
export function parseFundingInput(params: URLSearchParams) {
  if (
    [...params.keys()].some(k => !["wallet", "chainId", "token", "amount"].includes(k)) ||
    [...params.keys()].some(k => params.getAll(k).length !== 1)
  )
    throw new Error("Invalid quote parameters.");
  const wallet = params.get("wallet") ?? "",
    token = params.get("token") ?? "",
    amount = params.get("amount") ?? "",
    chainId = Number(params.get("chainId"));
  if (
    !/^0x[0-9a-f]{40}$/i.test(wallet) ||
    /^0x0{40}$/i.test(wallet) ||
    !/^0x[0-9a-f]{40}$/i.test(token) ||
    /^0x0{40}$/i.test(token) ||
    !fundingChains.some(c => c.id === chainId) ||
    !/^[1-9]\d{0,77}$/.test(amount) ||
    BigInt(amount) >= 2n ** 256n
  )
    throw new Error("Invalid wallet, network, token or amount.");
  return { wallet: wallet as `0x${string}`, token: token as `0x${string}`, chainId, amount };
}
// Only positively priced balances are offered. This reduces spam, but is not a token endorsement.
export function fundingTokens(rows: unknown[]): FundingToken[] {
  const result: FundingToken[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, any>;
    try {
      const chainId = networkIds[r.network],
        address = r.tokenAddress ?? NATIVE,
        decimals = r.tokenAddress == null ? 18 : r.tokenMetadata?.decimals;
      const price = Number(r.tokenPrices?.find((p: { currency: string }) => p.currency === "usd")?.value);
      const balance = BigInt(r.tokenBalance);
      const usd = (Number(balance) / 10 ** decimals) * price;
      const id = `${chainId}:${address.toLowerCase()}`;
      if (
        !chainId ||
        r.error ||
        !/^0x[0-9a-f]{40}$/i.test(address) ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 36 ||
        balance <= 0n ||
        !Number.isFinite(usd) ||
        usd < 0.1 ||
        seen.has(id)
      )
        continue;
      seen.add(id);
      result.push({
        chainId,
        address,
        decimals,
        balance: balance.toString(),
        usd,
        symbol: String(r.tokenAddress == null ? "ETH" : (r.tokenMetadata?.symbol ?? "Token")).slice(0, 20),
      });
    } catch {
      /* Ignore malformed individual balances; keep the rest of the scan. */
    }
  }
  return result.sort((a, b) => b.usd - a.usd);
}
