// Search, filter and sort for the basket cards. Pure, so it is tested without a browser.
import { totalValue } from "./value.ts";

export type ListRow = {
  basket: string;
  name: string;
  symbol: string;
  creator: string;
  managed: boolean;
  perShare: bigint;
  supply: bigint;
  balance: bigint;
  /** Component token symbols, e.g. ["tNVDA", "tAAPL"]. */
  tokens: string[];
};
export type Stats = Record<string, { createdAt: number; refs: Record<"24h" | "7d" | "all", string | null> }>;

export const FILTERS = [
  ["all", "All"],
  ["fixed", "Fixed"],
  ["managed", "Managed"],
  ["held", "I hold"],
  ["mine", "Mine"],
] as const;
export const SORTS = [
  ["value", "Total value"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["24h", "24h change"],
  ["all", "All-time change"],
  ["name", "Name"],
] as const;
export type Filter = (typeof FILTERS)[number][0];
export type Sort = (typeof SORTS)[number][0];

/** Change from `ref` to `now` in basis points; null without a reference. */
export function changeBps(now: bigint, ref: string | null | undefined) {
  if (!ref || BigInt(ref) === 0n || now === 0n) return null;
  return Number(((now - BigInt(ref)) * 10_000n) / BigInt(ref));
}

export function listBaskets<R extends ListRow>(
  rows: R[],
  { query, filter, sort, me, stats }: { query: string; filter: Filter; sort: Sort; me?: string; stats?: Stats },
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const mine = (row: R) => !!me && row.creator.toLowerCase() === me.toLowerCase();
  const stat = (row: R) => stats?.[row.basket.toLowerCase()];
  const kept = rows.filter(row => {
    if (filter === "fixed" && row.managed) return false;
    if (filter === "managed" && !row.managed) return false;
    if (filter === "held" && row.balance === 0n) return false;
    if (filter === "mine" && !mine(row)) return false;
    // Every word must match the name, ticker, a component, or the creator's address.
    const haystack = [row.name, row.symbol, row.creator, ...row.tokens].join(" ").toLowerCase();
    return words.every(word => haystack.includes(word));
  });
  // Missing numbers sort last whatever the direction; ties keep creation order.
  const byNumber = (value: (row: R) => number | null | undefined) => (a: R, b: R) =>
    (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || 0;
  const order: Record<Sort, (a: R, b: R) => number> = {
    newest: byNumber(row => stat(row)?.createdAt),
    oldest: byNumber(row => {
      const at = stat(row)?.createdAt;
      return at === undefined ? undefined : -at;
    }),
    value: byNumber(row => Number(totalValue(row.perShare, row.supply))),
    "24h": byNumber(row => changeBps(row.perShare, stat(row)?.refs["24h"])),
    all: byNumber(row => changeBps(row.perShare, stat(row)?.refs.all)),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return kept.sort(order[sort]);
}
