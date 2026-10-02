import { percentChange, rulesLine, timeAgo, totalValue, valuePerShare } from "./value.ts";
import assert from "node:assert/strict";

const usdg = "0xusdg";
const nvda = "0xnvda";
const aapl = "0xaapl";
// 0.01 NVDA at 230 + 0.02 AAPL at 337.5 + 5 USDG at face.
assert.equal(
  valuePerShare(
    [
      { token: nvda, unitsPerShare: 10n ** 16n },
      { token: aapl, unitsPerShare: 2n * 10n ** 16n },
      { token: usdg, unitsPerShare: 5_000_000n },
    ],
    { [nvda]: 230_000_000n, [aapl]: 337_500_000n },
    usdg,
  ),
  2_300_000n + 6_750_000n + 5_000_000n,
);
// Rounds each component up, as the purchase router does.
assert.equal(valuePerShare([{ token: nvda, unitsPerShare: 1n }], { [nvda]: 230_000_000n }, usdg), 1n);
// Missing or zero price: unknown, never 0.
assert.equal(valuePerShare([{ token: aapl, unitsPerShare: 1n }], {}, usdg), null);
assert.equal(valuePerShare([{ token: aapl, unitsPerShare: 1n }], { [aapl]: 0n }, usdg), null);
// Case-insensitive token keys.
assert.equal(valuePerShare([{ token: "0xNVDA", unitsPerShare: 10n ** 18n }], { [nvda]: 1n }, usdg), 1n);

const zero = "0x0000000000000000000000000000000000000000";
assert.equal(rulesLine({ manager: zero, noticeSeconds: 0, maxSlippageBps: 0 }), "Fixed");
assert.equal(
  rulesLine({ manager: nvda, noticeSeconds: 86_400, maxSlippageBps: 100 }),
  "Managed · 24 h notice · max 1% slippage",
);
assert.equal(
  rulesLine({ manager: nvda, noticeSeconds: 0, maxSlippageBps: 150 }),
  "Managed · no notice · max 1.5% slippage",
);

// Card stats: change against a stored reference, total value, and age.
assert.equal(percentChange(10_240_000n, "10000000"), "+2.40%");
assert.equal(percentChange(9_000_000n, "10000000"), "−10.0%");
assert.equal(percentChange(10_000_000n, "10000000"), "0.00%");
assert.equal(percentChange(10_000_000n, null), null);
assert.equal(percentChange(0n, "10000000"), null);
assert.equal(totalValue(12_230_000n, 5_130_000_000_000_000_000n), 62_739_900n);
const now = 1_790_000_000;
assert.equal(timeAgo(now - 20, now), "just now");
assert.equal(timeAgo(now - 3 * 3600, now), "3 hours ago");
assert.equal(timeAgo(now - 86_400, now), "yesterday");
assert.equal(timeAgo(now - 9 * 86_400, now), "last week");
