import { normalizeTheme, selectMatches } from "./matching.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

assert.equal(normalizeTheme("  chips   for robots  "), "chips for robots");
for (const input of [null, {}, "x", "x".repeat(181)]) assert.equal(normalizeTheme(input), null);
const score = (value, confidence = 0.9) => ({ type: "score", score: value, confidence });
assert.deepEqual(
  selectMatches({ answers: { A: score(2.8), B: score(2.9, 0.2), C: score(1), EVIL: score(3) } }, ["A", "B", "C"]),
  [{ symbol: "A", score: 2.8 }],
);
assert.throws(() => selectMatches({ answers: { A: score(NaN) } }, ["A"]));
assert.throws(() => selectMatches({ answers: {} }, ["A"]));
assert.throws(() => selectMatches({ answers: { A: score(3, 2) } }, ["A"]));
const symbols = Array.from({ length: 12 }, (_, i) => `S${i}`);
assert.equal(selectMatches({ answers: Object.fromEntries(symbols.map(s => [s, score(3)])) }, symbols).length, 8);
const logos = JSON.parse(readFileSync(new URL("./logos.json", import.meta.url)));
const profiles = JSON.parse(readFileSync(new URL("./profiles.json", import.meta.url)));
assert.equal(Object.keys(logos).length, 195);
assert.deepEqual(Object.keys(logos).sort(), Object.keys(profiles).sort());
for (const path of Object.values(logos)) {
  assert.match(path, /^\/stock-logos\/[A-Z0-9]+\.png$/);
  assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), path);
}
console.log("Discovery validation, matching bounds and 195 local logos passed");

const logoColors = JSON.parse(readFileSync(new URL("./logo-colors.json", import.meta.url)));
assert.deepEqual(Object.keys(logoColors).sort(), Object.keys(logos).sort());
assert.ok(logoColors.P.colors.includes("orange"));
assert.ok(!logoColors.NVDA.colors.includes("orange"));
assert.ok(logoColors.NVDA.colors.includes("green"));

const { surpriseIdeas } = await import("./prompts.ts");
assert.equal(surpriseIdeas.length, 20);
assert.equal(new Set(surpriseIdeas).size, 20);
assert.ok(surpriseIdeas.every(idea => normalizeTheme(idea) === idea));

const context = JSON.parse(readFileSync(new URL("./company-context.json", import.meta.url)));
assert.deepEqual(Object.keys(context).sort(), Object.keys(profiles).sort());
for (const company of Object.values(context)) {
  assert.ok(company.facts.length && company.sources.length, company.name);
  assert.ok(company.facts.every(fact => typeof fact === "string" && fact.trim()));
  assert.ok(company.sources.every(source => new URL(source).protocol === "https:"));
}
assert.ok(context.AAPL.facts.some(fact => fact.includes("Steve Jobs")));
assert.ok(context.TSLA.facts.some(fact => fact.includes("Martin Eberhard")));
console.log("Company context covers the catalog with attributed facts");

const { randomTokenCount, randomMatches } = await import("./matching.ts");
for (const query of ["5 random tokens", "show me 5 random stocks", "покажи 5 случайных токенов"])
  assert.equal(randomTokenCount(query), 5);
assert.equal(randomTokenCount("random tokens"), 8);
assert.equal(randomTokenCount("0 random tokens"), 0);
assert.equal(randomTokenCount("9 random tokens"), 9);
assert.equal(randomTokenCount("5 random AI tokens"), null);
assert.equal(randomTokenCount("companies with random access memory"), null);
const random = randomMatches([...symbols, symbols[0]], 5);
assert.equal(random.length, 5);
assert.equal(new Set(random.map(item => item.symbol)).size, 5);
assert.ok(random.every(item => symbols.includes(item.symbol)));
assert.equal(randomMatches(["A"], 5).length, 1);
assert.deepEqual(randomMatches([], 5), []);
console.log("Random discovery: requested count, distinct catalog tokens, English/Russian, thematic fallback passed.");
