import { rebuildHistory, thin } from "./history.ts";
import assert from "node:assert/strict";

const usdg = "0xusdg";
const a = "0xa";
const b = "0xb";
const ONE = 10n ** 18n;
const events = {
  createdAt: 100,
  start: [{ token: a, unitsPerShare: ONE }],
  rebalances: [{ at: 300, after: [{ token: b, unitsPerShare: 2n * ONE }] }],
  prices: [
    { at: 50, token: a, price: 10_000_000n }, // before creation: still the price at creation
    { at: 200, token: a, price: 12_000_000n },
    { at: 250, token: b, price: 6_000_000n }, // b not held yet: no point
    { at: 400, token: b, price: 7_000_000n },
    { at: 500, token: a, price: 99_000_000n }, // a no longer held: no point
  ],
  supply: [
    { at: 100, delta: 3n * ONE },
    { at: 350, delta: -ONE },
  ],
};

const points = rebuildHistory(events, usdg);
assert.deepEqual(
  points.map(p => [p.at, p.value, p.supply]),
  [
    [100, 10_000_000n, 3n * ONE],
    [200, 12_000_000n, 3n * ONE],
    [300, 12_000_000n, 3n * ONE], // rebalance: 2 b at 6 = 12
    [400, 14_000_000n, 2n * ONE],
  ],
);
assert.ok(points.every(p => p.source === "chain"));

// Only the gap before the first stored point.
assert.deepEqual(
  rebuildHistory(events, usdg, 300).map(p => p.at),
  [100, 200],
);

// A held token with no price yet is skipped, never drawn as 0.
assert.deepEqual(rebuildHistory({ ...events, prices: [] }, usdg), []);

// Thinning keeps the last point per bucket and every kept timestamp.
const many = [0, 10, 20, 70, 80, 130].map(at => ({ at, value: BigInt(at), supply: 1n, source: "cron" }));
assert.deepEqual(
  thin(many, 60, new Set([10])).map(p => p.at),
  [10, 20, 80, 130],
);
