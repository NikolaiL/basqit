import { listBaskets } from "./list.ts";
import assert from "node:assert/strict";

const me = "0xAAAA000000000000000000000000000000000001";
const row = (basket, name, symbol, extra = {}) => ({
  basket,
  name,
  symbol,
  creator: "0xbbbb000000000000000000000000000000000002",
  managed: false,
  perShare: 10_000_000n,
  supply: 10n ** 18n,
  balance: 0n,
  tokens: ["tNVDA"],
  ...extra,
});
const rows = [
  row("0x1", "Tech Five", "TECH5", { tokens: ["tNVDA", "tAAPL"], supply: 3n * 10n ** 18n }),
  row("0x2", "AI Builders", "AIB", { managed: true, balance: 1n, perShare: 11_000_000n }),
  row("0x3", "Quick Shift", "QUICK", { managed: true, creator: me, tokens: ["tTSLA"] }),
];
const stats = {
  "0x1": { createdAt: 100, refs: { "24h": "10000000", "7d": null, all: "9000000" } },
  "0x2": { createdAt: 300, refs: { "24h": "10000000", "7d": null, all: null } },
  "0x3": { createdAt: 200, refs: { "24h": null, "7d": null, all: "12000000" } },
};
const names = (opts) => listBaskets(rows, { query: "", filter: "all", sort: "newest", me, stats, ...opts }).map(r => r.symbol);

assert.deepEqual(names({}), ["AIB", "QUICK", "TECH5"]);
assert.deepEqual(names({ sort: "oldest" }), ["TECH5", "QUICK", "AIB"]);
assert.deepEqual(names({ sort: "value" }), ["TECH5", "AIB", "QUICK"]);
// 24h: AIB +10%, TECH5 0%, QUICK has no reference so it goes last.
assert.deepEqual(names({ sort: "24h" }), ["AIB", "TECH5", "QUICK"]);
// All time: TECH5 +11%, QUICK −16%, AIB unknown last.
assert.deepEqual(names({ sort: "all" }), ["TECH5", "QUICK", "AIB"]);
assert.deepEqual(names({ sort: "name" }), ["AIB", "QUICK", "TECH5"]);
assert.deepEqual(names({ filter: "fixed" }), ["TECH5"]);
assert.deepEqual(names({ filter: "managed" }), ["AIB", "QUICK"]);
assert.deepEqual(names({ filter: "held" }), ["AIB"]);
assert.deepEqual(names({ filter: "mine" }), ["QUICK"]);
assert.deepEqual(names({ filter: "mine", me: undefined }), []);
// Search: name, ticker, component, creator address; every word must match.
assert.deepEqual(names({ query: "tech" }), ["TECH5"]);
assert.deepEqual(names({ query: "taapl" }), ["TECH5"]);
assert.deepEqual(names({ query: "TSLA" }), ["QUICK"]);
assert.deepEqual(names({ query: "0xaaaa" }), ["QUICK"]);
assert.deepEqual(names({ query: "  ai builders " }), ["AIB"]);
assert.deepEqual(names({ query: "tech quick" }), []);
// Sorting does not change the caller's array.
assert.deepEqual(rows.map(r => r.symbol), ["TECH5", "AIB", "QUICK"]);
