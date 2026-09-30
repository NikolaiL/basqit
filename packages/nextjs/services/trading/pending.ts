// A submitted trade whose outcome is not known yet. Written before the wallet opens, so a timeout, reload
// or closed dialog can never make a sent purchase look retryable. Same rule as funding: only proof clears it.

export type PendingTrade = {
  /** Identifies one submission, so a later operation never clears someone else's record. */
  id: string;
  taker: string;
  chainId: number;
  // "tx": `ref` is a transaction hash. "calls": `ref` is an EIP-5792 bundle id.
  kind: "tx" | "calls";
  ref?: string;
  /** Learned from the chain while the transaction is visible; lets a replaced or dropped hash be recognised. */
  nonce?: number;
  tokens: string[];
  /** The batch this submission belongs to, so a late success can mark its legs bought. */
  batch?: string;
  /** The purchase call itself, so a hash the buyer pastes can be checked to be this purchase. */
  to?: string;
  data?: string;
  /** `ref` came from the buyer (wallet history), not from our own submission. */
  tracked?: boolean;
  createdAt: number;
};

// "replaced": the hash has no receipt but its nonce is used. A speed-up may still have bought, so this is never
// cleared automatically; the buyer checks wallet history.
// "unverified": a hash the buyer pasted is confirmed but is not this purchase (for example a cancellation), so it
// says nothing about whether anything was bought; the buyer decides.
export type TradeOutcome = "success" | "failure" | "unknown" | "replaced" | "unverified";

/** A multi-stock purchase: its original allocations and the legs confirmed so far, kept across remounts. */
export type BatchPurchase = {
  id: string;
  taker: string;
  chainId: number;
  legs: { token: string; sellAmount: string }[];
  bought: string[];
  createdAt: number;
};

const key = (chainId: number, taker: string) => `basqit-trade-v1:${chainId}:${taker.toLowerCase()}`;
const batchKey = (chainId: number, taker: string) => `basqit-batch-v1:${chainId}:${taker.toLowerCase()}`;

export const newOperationId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function readOwned<T extends { taker: string; chainId: number }>(storageKey: string, chainId: number, taker: string) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  const data = JSON.parse(raw) as T;
  if (data.taker?.toLowerCase() !== taker.toLowerCase() || data.chainId !== chainId)
    throw new Error("Saved trade is invalid. Check your wallet history before trading again.");
  return data;
}

export function readPendingTrade(chainId: number, taker: string): PendingTrade | null {
  return readOwned<PendingTrade>(key(chainId, taker), chainId, taker);
}

/** Throws if storage is unavailable: without a record, an unknown outcome could be bought twice. */
export function savePendingTrade(trade: PendingTrade) {
  localStorage.setItem(key(trade.chainId, trade.taker), JSON.stringify(trade));
}

/** Clears the record only if it is still the given operation's (or unconditionally without an id). */
export function clearPendingTrade(chainId: number, taker: string, id?: string) {
  if (id !== undefined && readPendingTrade(chainId, taker)?.id !== id) return;
  localStorage.removeItem(key(chainId, taker));
}

export function assertNoPendingTrade(chainId: number, taker: string) {
  if (readPendingTrade(chainId, taker))
    throw new Error("A previous trade from this wallet is still unresolved. Check it before trading again.");
}

export function readBatch(chainId: number, taker: string): BatchPurchase | null {
  return readOwned<BatchPurchase>(batchKey(chainId, taker), chainId, taker);
}

/** The saved batch while any leg is unbought; one whose every leg is bought is finished and removed here only. */
export function readActiveBatch(chainId: number, taker: string): BatchPurchase | null {
  const batch = readBatch(chainId, taker);
  if (batch && batch.legs.every(leg => batch.bought.includes(leg.token))) {
    clearBatch(chainId, taker);
    return null;
  }
  return batch;
}

export function saveBatch(batch: BatchPurchase) {
  localStorage.setItem(batchKey(batch.chainId, batch.taker), JSON.stringify(batch));
}

export function clearBatch(chainId: number, taker: string) {
  localStorage.removeItem(batchKey(chainId, taker));
}

/** Records confirmed legs of batch `id`; ignored if that batch is no longer the saved one. */
export function markBatchBought(chainId: number, taker: string, id: string, tokens: string[]) {
  const batch = readBatch(chainId, taker);
  if (!batch || batch.id !== id) return;
  const bought = Array.from(new Set([...batch.bought, ...tokens.map(token => token.toLowerCase())]));
  saveBatch({ ...batch, bought });
}

/**
 * One check-reserve-send at a time per wallet, across tabs (the funding panel's Web Locks pattern). Without it, two
 * callers can both see no pending trade and both send.
 */
export async function withTradeLock<T>(chainId: number, taker: string, action: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (!locks) throw new Error("This browser cannot safely coordinate trades. Use a current browser.");
  return locks.request(key(chainId, taker), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("A trade from this wallet is already being submitted in another tab.");
    return action();
  }) as Promise<T>;
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

/**
 * Looks the saved reference up on chain (or in the wallet, for a bundle). Unknown until there is an answer.
 * Returns the nonce too when the transaction is visible, so the caller can keep it for replacement detection.
 */
export async function reconcilePendingTrade(
  trade: PendingTrade,
  lookup: {
    receipt: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted" } | null>;
    transaction?: (
      hash: `0x${string}`,
    ) => Promise<{ nonce: number; from?: string; to?: string | null; input?: string } | null>;
    /** Count of the taker's confirmed transactions: every nonce below it is used. */
    confirmedNonce?: () => Promise<number>;
    calls?: (id: string) => Promise<{ status?: string } | null>;
  },
): Promise<{ outcome: TradeOutcome; nonce?: number }> {
  if (!trade.ref) return { outcome: "unknown" };
  if (trade.kind === "calls") {
    const result = lookup.calls ? await lookup.calls(trade.ref).catch(() => null) : null;
    return {
      outcome: result?.status === "success" ? "success" : result?.status === "failure" ? "failure" : "unknown",
    };
  }
  const hash = trade.ref as `0x${string}`;
  const receipt = await lookup.receipt(hash).catch(() => null);
  if (receipt && !trade.tracked) return { outcome: receipt.status === "success" ? "success" : "failure" };
  if (receipt) {
    // A pasted hash settles this purchase only if it is the same call from the same wallet (a sped-up copy).
    // A confirmed cancellation or any other transaction proves nothing about the purchase.
    const sent = lookup.transaction ? await lookup.transaction(hash).catch(() => null) : null;
    if (!sent) return { outcome: "unknown" };
    const same =
      !!trade.to &&
      !!trade.data &&
      sent.from?.toLowerCase() === trade.taker.toLowerCase() &&
      sent.to?.toLowerCase() === trade.to.toLowerCase() &&
      sent.input?.toLowerCase() === trade.data.toLowerCase() &&
      // A replacement reuses the original nonce; an identical call from another time is a different purchase. Without
      // the original nonce there is no proof, so the buyer answers from wallet history instead.
      trade.nonce !== undefined &&
      sent.nonce === trade.nonce;
    // Never report a pasted transaction's nonce: it is not evidence about the original.
    if (!same) return { outcome: "unverified" };
    return { outcome: receipt.status === "success" ? "success" : "failure" };
  }
  const seen = lookup.transaction ? await lookup.transaction(hash).catch(() => null) : null;
  // The first nonce learned is kept, and only from our own submission: a pasted hash must never become the original.
  const nonce = trade.nonce ?? (trade.tracked ? undefined : seen?.nonce);
  if (nonce === undefined || !lookup.confirmedNonce) return { outcome: "unknown", nonce };
  const confirmed = await lookup.confirmedNonce().catch(() => undefined);
  // The nonce is used, yet this hash has no receipt: it was replaced (sped up or cancelled) or dropped.
  return { outcome: confirmed !== undefined && confirmed > nonce ? "replaced" : "unknown", nonce };
}
