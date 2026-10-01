import { basketManagement } from "./management.ts";
import assert from "node:assert/strict";

assert.deepEqual(basketManagement(false, "bad", "bad"), { managed: false, noticeHours: 0, maxSlippageBps: 0 });
assert.deepEqual(basketManagement(true, "24", "1"), { managed: true, noticeHours: 24, maxSlippageBps: 100 });
assert.deepEqual(basketManagement(true, "0", ".1"), { managed: true, noticeHours: 0, maxSlippageBps: 10 });
assert.deepEqual(basketManagement(true, "72", "2"), { managed: true, noticeHours: 72, maxSlippageBps: 200 });
assert.equal(basketManagement(true, "12", "1.01").maxSlippageBps, 101);
for (const notice of ["", "-1", "1.5", "73", "Infinity", "1e1"])
  assert.equal(basketManagement(true, notice, "1"), null);
for (const slippage of ["", "0", "0.09", "2.01", "1.001", "-1", "Infinity", "1e0"])
  assert.equal(basketManagement(true, "24", slippage), null);
console.log("Managed settings bounds, exact percentage conversion, and fixed-basket reset passed.");
