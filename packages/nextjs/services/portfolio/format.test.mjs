import { actionDate, amount, compactAmount, dividendEstimate, dividendHistory, tokenValue } from "./format.ts";
import assert from "node:assert/strict";

// 2 tokens × 4 shares/token × $100 mid = $800; no double multiplier.
assert.equal(tokenValue(2n * 10n ** 18n, 18, 4n * 10n ** 18n, "99", "101"), "800");
assert.equal(tokenValue(1250000n, 6, 10n ** 18n, "2", "2"), "2.5");
assert.equal(tokenValue(1n, 18, 10n ** 18n, "1", "1"), "0.000000000000000001");
assert.equal(tokenValue(1n, 18, 0n, "1", "1"), null);
assert.equal(tokenValue(1n, 18, 10n ** 18n, "2", "1"), null);
assert.equal(tokenValue(1n, 18, 10n ** 18n, "NaN", "1"), null);
assert.equal(actionDate({ year: 2026, month: 2, day: 30 }), null);
assert.equal(actionDate({ year: 2026, month: 9, day: 25 }), "2026-09-25");
assert.equal(actionDate(null), null);
assert.equal(amount("0.000000000000000001", 6), "<0.000001");
console.log("Portfolio arithmetic and date checks passed.");

const events = [
  { symbol: "AAPL", type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND", date: "2026-06-01" },
  { symbol: "MSFT", type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND", date: "2026-09-01" },
  { symbol: "AAPL", type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT", date: "2026-09-02" },
  { symbol: "AAPL", type: "CORPORATE_ACTION_TYPE_STOCK_DIVIDEND", date: "2026-09-03" },
  { symbol: "AAPL", type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND", date: null },
];
assert.deepEqual(dividendHistory(events, "AAPL"), [events[3], events[0], events[4]]);
assert.deepEqual(dividendHistory(events, "NVDA"), []);
assert.equal(events[0].date, "2026-06-01");
console.log("Dividend history filtering and ordering checks passed.");

assert.deepEqual(dividendEstimate("2", "1", "99", "101"), { after: "2.02", price: "100" });
assert.equal(dividendEstimate("1", "1", "0", "0"), null);
assert.equal(dividendEstimate("1", "1", "101", "99"), null);
assert.equal(dividendEstimate("bad", "1", "99", "101"), null);
assert.deepEqual(dividendEstimate("1", "0", "100", "100"), { after: "1", price: "100" });
console.log("Dividend scenario checks passed.");

assert.equal(compactAmount("0.032814615330437867"), "0.03281");
assert.equal(compactAmount("7.384081"), "7.384");
assert.equal(compactAmount("0.000001234567"), "0.0₅1235");
assert.equal(compactAmount("0.000000000000000001"), "0.0₁₇1");
assert.equal(compactAmount("-0.000001234567"), "-0.0₅1235");
assert.equal(compactAmount("0.0000999999"), "0.0001");
assert.equal(compactAmount("123456"), "123,500");
assert.equal(compactAmount("0"), "0");
assert.equal(compactAmount(null), "Unavailable");
assert.equal(compactAmount("NaN"), "Unavailable");
console.log("Four significant digits, zero subscripts and rounding checks passed.");
