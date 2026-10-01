import { type Component, valuePerShare } from "./value.ts";

export type Point = { at: number; value: bigint; supply: bigint; source: "cron" | "chain" };
export type HistoryEvents = {
  createdAt: number;
  start: Component[];
  rebalances: { at: number; after: Component[] }[];
  prices: { at: number; token: string; price: bigint }[];
  supply: { at: number; delta: bigint }[];
};

/** Value per share over time from on-chain events: holdings from creation and each rebalance, prices from each
 * PriceSet. One point at creation, at every price change of a held token and at every rebalance, before `until`. */
export function rebuildHistory(events: HistoryEvents, usdg: string, until = Infinity): Point[] {
  const prices: Record<string, bigint> = {};
  const moments = [
    ...events.prices.map(p => ({ at: p.at, kind: "price" as const, p })),
    ...events.rebalances.map(r => ({ at: r.at, kind: "rebalance" as const, r })),
  ].sort((x, y) => x.at - y.at || (x.kind === "price" ? -1 : 1));
  const supplyAt = (at: number) => events.supply.filter(s => s.at <= at).reduce((sum, s) => sum + s.delta, 0n);
  let holding = events.start;
  const held = (token: string) => holding.some(c => c.token.toLowerCase() === token.toLowerCase());
  const points: Point[] = [];
  const add = (at: number) => {
    if (at >= until) return;
    const value = valuePerShare(holding, prices, usdg);
    if (value !== null) points.push({ at, value, supply: supplyAt(at), source: "chain" });
  };
  let created = false;
  for (const m of moments) {
    if (!created && m.at >= events.createdAt) {
      add(events.createdAt);
      created = true;
    }
    if (m.kind === "price") {
      prices[m.p.token.toLowerCase()] = m.p.price;
      if (created && m.at > events.createdAt && held(m.p.token)) add(m.at);
    } else {
      holding = m.r.after;
      add(m.at);
    }
  }
  if (!created) add(events.createdAt);
  return points;
}

/** The last point in each `step`-second bucket, plus every point whose time is in `keep` (rebalances). */
export function thin(points: Point[], step: number, keep: Set<number> = new Set()): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (keep.has(p.at) || !next || Math.floor(next.at / step) !== Math.floor(p.at / step)) out.push(p);
  }
  return out;
}

/** The thinning step for a chart: the range's step, smaller when the history is short, so about 150 points at most
 * and a young basket still draws a line. */
export function chartStep(points: { at: number }[], maxStep: number) {
  if (points.length < 2) return maxStep;
  const span = points[points.length - 1].at - points[0].at;
  return Math.min(maxStep, Math.max(1, Math.floor(span / 150)));
}
