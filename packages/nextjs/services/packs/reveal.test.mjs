import { confirmedPayouts } from "./reveal.ts";
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
