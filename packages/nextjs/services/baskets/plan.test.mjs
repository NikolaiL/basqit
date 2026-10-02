import { planEstimate, planStatus, toContractPlan } from "./plan.ts";
import assert from "node:assert/strict";

const ONE = 10n ** 18n;
const usdg = "0xusdg";
const a = "0xa";
const b = "0xb";
const current = [
  { token: a, unitsPerShare: ONE },
  { token: b, unitsPerShare: ONE },
];

// Sell half of a into b and usdg, 60/40.
const draft = { sells: { [a]: ONE / 2n }, buys: { [b]: 60, [usdg]: 40 } };
assert.deepEqual(toContractPlan(current, draft), {
  sells: [{ token: a, unitsPerShare: ONE / 2n }],
  buys: [
    { token: b, bps: 6000 },
    { token: usdg, bps: 4000 },
  ],
});
assert.deepEqual(toContractPlan(current, { sells: {}, buys: { [b]: 100 } }), { error: "Lower at least one holding." });
assert.deepEqual(toContractPlan(current, { sells: { [a]: 0n }, buys: { [b]: 90 } }), {
  error: "The split must add up to 100%.",
});
assert.deepEqual(toContractPlan(current, { sells: { [a]: 0n }, buys: { [a]: 100 } }), {
  error: "A token cannot be sold and bought at once.",
});
assert.deepEqual(toContractPlan(current, { sells: { [a]: 2n * ONE }, buys: { [b]: 100 } }), {
  error: "Holdings can only be lowered.",
});

// Estimate per share: 0.5 a at $10 = $5 sold; b at $4 gets $3 → 0.75 b; usdg gets $2.
const estimate = planEstimate({
  current,
  draft,
  supply: 10n * ONE,
  prices: { [a]: 10_000_000n, [b]: 4_000_000n },
  usdg,
});
assert.equal(estimate.soldValue, 5_000_000n);
assert.deepEqual(estimate.perBuy, [
  { token: b, usdg: 3_000_000n, unitsPerShare: 750_000_000_000_000_000n },
  { token: usdg, usdg: 2_000_000n, unitsPerShare: 2_000_000n },
]);
// No shares: nothing to rebalance.
assert.deepEqual(planEstimate({ current, draft, supply: 0n, prices: { [a]: 1n, [b]: 1n }, usdg }), {
  error: "The basket has no shares yet.",
});

// Status.
const base = { window: 86_400, lastRebalanceAt: 0, interval: 14_400 };
assert.equal(planStatus({ ...base, now: 100, readyAt: 0 }).state, "none");
assert.deepEqual(planStatus({ ...base, now: 100, readyAt: 200 }), { state: "waiting", opensAt: 200, closesAt: 86_600 });
assert.equal(planStatus({ ...base, now: 300, readyAt: 200 }).state, "ready");
assert.equal(planStatus({ ...base, now: 86_601, readyAt: 200 }).state, "lapsed");
assert.equal(planStatus({ ...base, now: 1000, readyAt: 0, lastRebalanceAt: 900 }).nextAllowedAt, 15_300);

// The 4-hour gap since the last rebalance delays an announced plan, even after its notice ends.
const gap = { ...base, readyAt: 1_000, lastRebalanceAt: 900 };
assert.deepEqual(planStatus({ ...gap, now: 2_000 }), { state: "waiting", opensAt: 15_300, closesAt: 87_400 });
assert.equal(planStatus({ ...gap, now: 15_300 }).state, "ready");
// A gap that ends after the window closes: the plan can never run.
assert.equal(planStatus({ ...gap, lastRebalanceAt: 80_000, now: 2_000 }).state, "blocked");
assert.equal(planStatus({ ...gap, now: 87_401 }).state, "lapsed");
