import { PACK_TYPES, packPresentation } from "./catalog.ts";
import assert from "node:assert/strict";

assert.deepEqual(
  PACK_TYPES.map(pack => pack.price),
  [1_000_000n, 10_000_000n, 100_000_000n],
);
assert.equal(packPresentation(100_000_000n).name, "Gold");
assert.equal(packPresentation(10_000_000n).name, "Silver");
assert.equal(packPresentation(1_000_000n).name, "Bronze");
// Old purchases must never take on the currently selected pack's identity.
assert.equal(packPresentation(100_000n).name, "Original");
assert.equal(packPresentation(undefined).name, "Original");

const { rankedPayouts, averagePayout } = await import("./catalog.ts");
const mixed = [
  { token: "0xa", amount: 10n ** 18n, end: 700 },
  { token: "0xb", amount: 10n ** 17n, end: 1000 },
];
const prices = { "0xa": 2, "0xb": 100 };
assert.deepEqual(
  rankedPayouts(mixed, prices).map(card => [card.index, card.chance]),
  [
    [1, 30],
    [0, 70],
  ],
);
assert.equal(mixed[0].token, "0xa");
assert.equal(averagePayout(mixed, prices), 4.4);
assert.equal(averagePayout(mixed, { "0xa": 2 }), undefined);
assert.deepEqual(
  rankedPayouts(mixed, {}).map(card => card.index),
  [1, 0],
);

assert.deepEqual(
  rankedPayouts(mixed, { "0xa": 2 }).map(card => card.index),
  [1, 0],
);

// Average across every stock eligible for each value level, not only the display examples.
const pool = [
  { token: "0xa", referencePriceUsdG: 2_000_000n, amounts: [1_000_000_000_000_000_000n, 5_000_000_000_000_000_000n] },
  { token: "0xb", referencePriceUsdG: 100_000_000n, amounts: [20_000_000_000_000_000n, 100_000_000_000_000_000n] },
];
assert.equal(averagePayout(mixed, prices, pool), 4.4);
assert.equal(averagePayout(mixed, { "0xa": 2 }, pool), undefined);

// Calibrated return follows the selected on-chain table, including older configurations.
const revisedLevels = [657, 970, 989, 999, 1000].map((end, index) => ({
  token: "0xa",
  amount: [50n, 125n, 175n, 350n, 1200n][index] * 10n ** 16n,
  end,
}));
assert.equal(averagePayout(revisedLevels, { "0xa": 1 }), 0.8);
const revisedPool = [
  { token: "0xb", referencePriceUsdG: 2_000_000n, amounts: revisedLevels.map(tier => tier.amount / 2n) },
];
assert.equal(averagePayout(revisedLevels, { "0xb": 2 }, revisedPool), 0.8);
