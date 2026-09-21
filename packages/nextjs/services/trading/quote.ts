import { type Address, decodeAbiParameters, formatUnits, isAddress } from "viem";

export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734" as const;
export const TRADE_CHAIN = 4663;
export const SLIPPAGE_BPS = 50;
// Re-enable only after 0x grants this integrator RWA access.
export const ZEROX_ENABLED = false;

export type SwapFee = { bps: number; recipient: Address | null };

export function swapFeeConfig(bps = "10", recipient = ""): SwapFee {
  if (!/^\d+$/.test(bps) || Number(bps) > 100)
    throw new Error("BASQIT_SWAP_FEE_BPS must be an integer from 0 to 100 (0–1%).");
  if (Number(bps) === 0) return { bps: 0, recipient: null };
  if (!isAddress(recipient) || /^0x0{40}$/i.test(recipient))
    throw new Error("Set BASQIT_SWAP_FEE_RECIPIENT to enable trading with a Basqit fee.");
  return { bps: Number(bps), recipient: recipient as Address };
}

export type TradeAsset = { symbol: string; address: `0x${string}` };
export type TradeQuote = {
  provider: "uniswap" | "0x";
  spender: `0x${string}`;
  pool?: `0x${string}`;
  impactBps?: number;
  basqitFee: SwapFee & { amount: string; token: Address };
  providerFee?: { amount: string; token: Address };
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  sellDecimals: number;
  buyDecimals: number;
  balance: string;
  allowance: string;
  taker: `0x${string}`;
  expiresAt: number;
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string };
};

export type ExecutionQuote = Pick<
  TradeQuote,
  "provider" | "spender" | "sellToken" | "sellAmount" | "taker" | "expiresAt" | "transaction"
>;

const uint = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,78}$/.test(value) && BigInt(value) < 2n ** 256n;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

// The upstream API is trusted for routing, but cannot change the pair, amount or approval target.
export function validateQuote(
  raw: unknown,
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  fee: SwapFee = { bps: 0, recipient: null },
) {
  const q = raw as Record<string, any> | null;
  if (
    !q ||
    q.liquidityAvailable !== true ||
    !same(q.sellToken, sellToken) ||
    !same(q.buyToken, buyToken) ||
    q.sellAmount !== sellAmount ||
    !uint(q.buyAmount) ||
    !uint(q.minBuyAmount) ||
    BigInt(q.minBuyAmount) <= 0n ||
    BigInt(q.minBuyAmount) > BigInt(q.buyAmount) ||
    BigInt(q.minBuyAmount) < (BigInt(q.buyAmount) * BigInt(10000 - SLIPPAGE_BPS)) / 10000n ||
    (q.allowanceTarget && !same(q.allowanceTarget, ALLOWANCE_HOLDER)) ||
    (q.issues?.allowance && !same(q.issues.allowance.spender, ALLOWANCE_HOLDER)) ||
    !same(q.transaction?.to, ALLOWANCE_HOLDER) ||
    q.transaction?.value !== "0" ||
    typeof q.transaction?.data !== "string" ||
    !/^0x2213bc0b[0-9a-fA-F]+$/.test(q.transaction.data) ||
    q.transaction.data.length % 2 !== 0 ||
    q.transaction.data.length > 200000
  )
    throw new Error("No supported executable quote is available. Try another amount or try again later.");
  const [, encodedToken, encodedAmount] = decodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes" }],
    `0x${q.transaction.data.slice(10)}`,
  );
  if (!same(encodedToken, sellToken) || encodedAmount !== BigInt(sellAmount))
    throw new Error("Quote calldata does not match the requested token and amount.");
  const fees = q.fees?.integratorFees ?? (q.fees?.integratorFee ? [q.fees.integratorFee] : []);
  if (!Array.isArray(fees) || fees.length > 1) throw new Error("Unexpected swap fee response.");
  const reportedFee = fees[0];
  const providerFee = q.fees?.zeroExFee;
  if (
    providerFee &&
    (!uint(providerFee.amount) || (!same(providerFee.token, buyToken) && !same(providerFee.token, sellToken)))
  )
    throw new Error("Unexpected provider fee.");
  const providerBuyFee = providerFee && same(providerFee.token, buyToken) ? BigInt(providerFee.amount) : 0n;
  if (fee.bps > 0) {
    if (
      !reportedFee ||
      !uint(reportedFee.amount) ||
      !same(reportedFee.token, buyToken) ||
      (reportedFee.recipient && !same(reportedFee.recipient, fee.recipient!)) ||
      BigInt(reportedFee.amount) >
        ((BigInt(q.buyAmount) + BigInt(reportedFee.amount) + providerBuyFee) * BigInt(fee.bps)) / 10000n + 1n
    )
      throw new Error("Quote fee does not match the configured Basqit fee.");
  } else if (reportedFee && (!uint(reportedFee.amount) || BigInt(reportedFee.amount) !== 0n)) {
    throw new Error("Unexpected swap fee.");
  }
  return {
    providerFee: providerFee
      ? { amount: providerFee.amount as string, token: providerFee.token as Address }
      : undefined,
    basqitFee: { ...fee, amount: reportedFee?.amount ?? "0", token: buyToken as Address },
    buyAmount: q.buyAmount as string,
    minBuyAmount: q.minBuyAmount as string,
    transaction: { to: ALLOWANCE_HOLDER, data: q.transaction.data as `0x${string}`, value: "0" },
  };
}

export function quoteError(status: number, name?: unknown) {
  if (name === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE" || name === "SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE")
    return {
      status: 403,
      error:
        "0x does not authorize trading this token due to legal restrictions. Trading is unavailable through this provider.",
    };
  if (status === 401 || status === 403)
    return {
      status: 503,
      error: "The quote provider denied access. The server’s 0x credentials or permissions need checking.",
    };
  return {
    status: 503,
    error:
      status === 429
        ? "Quote service is busy. Wait a moment and retry."
        : "No swap route is available for this amount right now.",
  };
}

export function balancePercentage(balance: bigint, decimals: number, percentage: number) {
  if (balance < 0n || !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
    throw new Error("Invalid balance percentage");
  return formatUnits((balance * BigInt(percentage)) / 100n, decimals);
}
