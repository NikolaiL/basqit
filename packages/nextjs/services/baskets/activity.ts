const ZERO = "0x0000000000000000000000000000000000000000";

export type Activity = {
  at: number;
  hash: string;
  kind: "bought" | "sold" | "created" | "announced" | "rebalanced" | "cancelled" | "minted" | "redeemed";
  who: string;
  shares?: bigint;
  usdg?: bigint;
};

/** Balances from Transfer logs, largest first; routers only hold shares inside a transaction, so they are left out. */
export function holdersFromTransfers(transfers: { from: string; to: string; value: bigint }[], exclude: string[]) {
  const skip = new Set([ZERO, ...exclude.map(a => a.toLowerCase())]);
  const balances = new Map<string, bigint>();
  for (const { from, to, value } of transfers) {
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (!skip.has(f)) balances.set(f, (balances.get(f) ?? 0n) - value);
    if (!skip.has(t)) balances.set(t, (balances.get(t) ?? 0n) + value);
  }
  return [...balances]
    .filter(([, shares]) => shares > 0n)
    .map(([address, shares]) => ({ address, shares }))
    .sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0));
}

/** Newest first; a mint or redeem inside a router purchase or sale is that purchase or sale, not a second row. */
export function mergeActivity(rows: Activity[]) {
  const traded = new Set(rows.filter(r => r.kind === "bought" || r.kind === "sold").map(r => r.hash));
  return rows
    .filter(r => !((r.kind === "minted" || r.kind === "redeemed") && traded.has(r.hash)))
    .sort((a, b) => b.at - a.at);
}
