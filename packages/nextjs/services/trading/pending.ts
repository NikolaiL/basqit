// A submitted trade whose outcome is not known yet. Written before the wallet opens, so a timeout, reload
// or closed dialog can never make a sent purchase look retryable. Same rule as funding: only proof clears it.

export type PendingTrade = {
  taker: string;
  chainId: number;
  // "tx": `ref` is a transaction hash. "calls": `ref` is an EIP-5792 bundle id.
  kind: "tx" | "calls";
  ref?: string;
  tokens: string[];
  createdAt: number;
};

export type TradeOutcome = "success" | "failure" | "unknown";

const key = (chainId: number, taker: string) => `basqit-trade-v1:${chainId}:${taker.toLowerCase()}`;

export function readPendingTrade(chainId: number, taker: string): PendingTrade | null {
  const raw = localStorage.getItem(key(chainId, taker));
  if (!raw) return null;
  const data = JSON.parse(raw) as PendingTrade;
  if (data.taker?.toLowerCase() !== taker.toLowerCase() || data.chainId !== chainId)
    throw new Error("Saved trade is invalid. Check your wallet history before trading again.");
  return data;
}

/** Throws if storage is unavailable: without a record, an unknown outcome could be bought twice. */
export function savePendingTrade(trade: PendingTrade) {
  localStorage.setItem(key(trade.chainId, trade.taker), JSON.stringify(trade));
}

export function clearPendingTrade(chainId: number, taker: string) {
  localStorage.removeItem(key(chainId, taker));
}

export function assertNoPendingTrade(chainId: number, taker: string) {
  if (readPendingTrade(chainId, taker))
    throw new Error("A previous trade from this wallet is still unresolved. Check it before trading again.");
}

// EIP-4001 user rejection, and EIP-5792 errors that mean the wallet refused the batch before sending anything.
// 5720 (duplicate id) is excluded: something with that id was already submitted.
const NOT_SENT = new Set([4001, 5700, 5710, 5740, 5750, 5760]);
// Batch shapes the wallet cannot do at all; the caller may offer separate steps after the user reviews that.
const UNSUPPORTED_BATCH = new Set([5700, 5710, 5740, 5760]);

export function walletErrorCode(error: unknown): number | undefined {
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 10; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "number") return code;
    e = (e as { cause?: unknown }).cause;
  }
}

export const provesNotSent = (error: unknown) => NOT_SENT.has(walletErrorCode(error) ?? 0);
export const isUnsupportedBatch = (error: unknown) => UNSUPPORTED_BATCH.has(walletErrorCode(error) ?? 0);

/** Looks the saved reference up on chain (or in the wallet, for a bundle). Unknown until there is an answer. */
export async function reconcilePendingTrade(
  trade: PendingTrade,
  lookup: {
    receipt: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted" } | null>;
    calls?: (id: string) => Promise<{ status?: string } | null>;
  },
): Promise<TradeOutcome> {
  if (!trade.ref) return "unknown";
  if (trade.kind === "tx") {
    const receipt = await lookup.receipt(trade.ref as `0x${string}`).catch(() => null);
    return receipt ? (receipt.status === "success" ? "success" : "failure") : "unknown";
  }
  const result = lookup.calls ? await lookup.calls(trade.ref).catch(() => null) : null;
  return result?.status === "success" ? "success" : result?.status === "failure" ? "failure" : "unknown";
}
