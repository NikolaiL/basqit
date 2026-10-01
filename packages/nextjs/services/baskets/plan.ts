import type { Component } from "./value.ts";

const ONE = 10n ** 18n;
export type Draft = { sells: Record<string, bigint>; buys: Record<string, number> };

const lower = (t: string) => t.toLowerCase();

/** The plan in the contract's terms, or the first thing the creator needs to fix. */
export function toContractPlan(current: Component[], draft: Draft) {
  const units = new Map(current.map(c => [lower(c.token), c.unitsPerShare]));
  const sells = Object.entries(draft.sells)
    .filter(([token, next]) => next !== units.get(lower(token)))
    .map(([token, unitsPerShare]) => ({ token, unitsPerShare }));
  if (!sells.length) return { error: "Lower at least one holding." };
  if (sells.some(s => s.unitsPerShare > (units.get(lower(s.token)) ?? 0n)))
    return { error: "Holdings can only be lowered." };
  const buys = Object.entries(draft.buys)
    .filter(([, percent]) => percent > 0)
    .map(([token, percent]) => ({ token, bps: Math.round(percent * 100) }));
  if (buys.reduce((sum, b) => sum + b.bps, 0) !== 10_000) return { error: "The split must add up to 100%." };
  const sold = new Set(sells.map(s => lower(s.token)));
  if (buys.some(b => sold.has(lower(b.token)))) return { error: "A token cannot be sold and bought at once." };
  return { sells, buys };
}

/** What one share sells and what each buy receives, at reference prices; before swap costs. */
export function planEstimate(input: {
  current: Component[];
  draft: Draft;
  supply: bigint;
  prices: Record<string, bigint>;
  usdg: string;
}) {
  if (input.supply === 0n) return { error: "The basket has no shares yet." };
  const plan = toContractPlan(input.current, input.draft);
  if ("error" in plan) return plan;
  const units = new Map(input.current.map(c => [lower(c.token), c.unitsPerShare]));
  const isUsdg = (t: string) => lower(t) === lower(input.usdg);
  const price = (t: string) => input.prices[lower(t)] ?? 0n;
  let soldValue = 0n;
  for (const s of plan.sells) {
    const diff = units.get(lower(s.token))! - s.unitsPerShare;
    soldValue += isUsdg(s.token) ? diff : (diff * price(s.token)) / ONE;
  }
  const perBuy = plan.buys.map(b => {
    const usdg = (soldValue * BigInt(b.bps)) / 10_000n;
    const p = price(b.token);
    return { token: b.token, usdg, unitsPerShare: isUsdg(b.token) ? usdg : p ? (usdg * ONE) / p : 0n };
  });
  return { soldValue, perBuy };
}

/** Where an announced plan stands, and when the next rebalance may run. */
export function planStatus(i: {
  now: number;
  readyAt: number;
  window: number;
  lastRebalanceAt: number;
  interval: number;
}) {
  const next = i.lastRebalanceAt ? { nextAllowedAt: i.lastRebalanceAt + i.interval } : {};
  if (!i.readyAt) return { state: "none" as const, ...next };
  const closesAt = i.readyAt + i.window;
  if (i.now < i.readyAt) return { state: "waiting" as const, opensAt: i.readyAt, closesAt };
  if (i.now <= closesAt) return { state: "ready" as const, opensAt: i.readyAt, closesAt, ...next };
  return { state: "lapsed" as const };
}
