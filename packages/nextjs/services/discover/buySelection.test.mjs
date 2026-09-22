import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../components/discover/StockDiscovery.tsx", import.meta.url), "utf8");
const handler = source.match(/onClick=\{\(\) => \{\s*(const selected = matches\.flatMap[\s\S]*?)\n\s*\}\}/)?.[1];
assert.ok(handler, "Discover buy handler exists");
const assets = [{ symbol: "AAPL" }, { symbol: "NVDA" }];
for (const count of [0, 1, 2]) {
  let single, batch, analytics;
  vm.runInNewContext(`(() => { ${handler} })()`, {
    assets,
    matches: assets.slice(0, count),
    query: "test",
    matchSymbols: "",
    setTrade: value => {
      single = value;
    },
    setBuyList: value => {
      batch = value;
    },
    trackDiscovery: (_event, _query, value) => {
      analytics = value;
    },
  });
  if (count === 1) {
    assert.equal(single.asset, assets[0]);
    assert.equal(single.side, "buy");
    assert.equal(batch, undefined);
    assert.equal(analytics.mode, "single");
  } else if (count === 2) {
    assert.equal(batch.length, 2);
    assert.equal(single, undefined);
    assert.equal(analytics.mode, "batch");
  } else assert.equal(single ?? batch ?? analytics, undefined);
}
console.log("Discover Buy: one result opens single trade, multiple open batch, empty does nothing.");
