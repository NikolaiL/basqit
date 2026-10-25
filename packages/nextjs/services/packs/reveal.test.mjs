import { amount } from "../portfolio/format.ts";
import { confirmedPayouts, payoutValueUsd } from "./reveal.ts";
import assert from "node:assert/strict";

const payouts = [{ token: "0x01", amount: 10n, slot: 42, paid: false }];
assert.equal(confirmedPayouts(undefined, payouts), undefined);
assert.equal(confirmedPayouts({ revealed: false, quantity: 1 }, payouts), undefined);
assert.equal(confirmedPayouts({ revealed: true, quantity: 1 }, undefined), undefined);
assert.equal(confirmedPayouts({ revealed: true, quantity: 2 }, payouts), undefined);
assert.equal(confirmedPayouts({ revealed: true, quantity: 1 }, payouts), payouts);

const { payoutLevel } = await import("./reveal.ts");
const levels = [
  { end: 699, name: "Common" },
  { end: 1000, name: "Rare" },
];
// Level follows the value slot, even when the stock differs from the display example.
assert.equal(payoutLevel(levels, { ...payouts[0], token: "0xbb", slot: 42 }).name, "Common");
assert.equal(payoutLevel(levels, { ...payouts[0], token: "0xcc", slot: 699 }).name, "Rare");
assert.equal(payoutLevel(levels, { ...payouts[0], slot: 999 }).name, "Rare");
assert.equal(payoutLevel(levels, { ...payouts[0], slot: 1000 }), undefined);

assert.equal(amount("0.032248095346868575", 6), "0.032248");
assert.equal(amount("1.23456789", 6), "1.234568");
assert.equal(amount("2.500000000000000000", 6), "2.5");
assert.equal(amount("0.000000000000000001", 6), "<0.000001");
assert.equal(payoutValueUsd(10n ** 17n, 20), 2);
// USD uses the full payout, even when the displayed quantity is below six decimal places.
assert.equal(payoutValueUsd(1n, 1e18), 1);
for (const price of [undefined, 0, -1, NaN, Infinity]) assert.equal(payoutValueUsd(10n ** 18n, price), undefined);
