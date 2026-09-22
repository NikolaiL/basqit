import { packQuestions } from "./request-budget.ts";
import assert from "node:assert/strict";

const questions = Object.fromEntries(Array.from({ length: 195 }, (_, i) => [`S${i}`, { text: "東京🚀".repeat(200) }]));
const batches = packQuestions({ theme: "founders" }, questions);
assert.ok(batches.length > 1);
assert.deepEqual(Object.assign({}, ...batches), questions);
for (const batch of batches) {
  assert.ok(
    new TextEncoder().encode(JSON.stringify({ state: { theme: "founders" }, questions: batch })).length < 48000,
  );
}
assert.throws(() => packQuestions({}, { A: "🚀".repeat(6000) }), /input budget/);
assert.throws(() => packQuestions("x".repeat(24000), { A: "tiny" }), /input budget/);
assert.deepEqual(packQuestions({}, {}), []);
console.log("Jev byte budgets, Unicode, oversize rejection and complete catalog packing passed");
