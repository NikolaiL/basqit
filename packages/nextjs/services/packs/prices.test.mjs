import { midPriceUsdG } from "./prices.ts";
import assert from "node:assert/strict";

assert.equal(midPriceUsdG({ currency: "USD", tokenBid: "180.10", tokenAsk: "180.20" }), 180_150_000n);
assert.equal(midPriceUsdG({ currency: "USD", tokenBid: 1, tokenAsk: 1 }), 1_000_000n);
for (const bad of [
  { currency: "EUR", tokenBid: 1, tokenAsk: 1 },
  { currency: "USD", tokenBid: 0, tokenAsk: 1 },
  { currency: "USD", tokenBid: "x", tokenAsk: 1 },
  { currency: "USD" },
])
  assert.equal(midPriceUsdG(bad), null);
