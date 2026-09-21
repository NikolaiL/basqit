import { readTokenData } from "./token-data.ts";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
let calls = 0;
let fail = false;
globalThis.fetch = async () => {
  calls++;
  return new Response(JSON.stringify({ assets: [], quotes: [], corpActions: [] }), { status: fail ? 503 : 200 });
};
try {
  await Promise.all(Array.from({ length: 20 }, () => readTokenData("assets")));
  assert.equal(calls, 1, "concurrent reads deduplicate");
  now += 299999;
  await readTokenData("assets");
  assert.equal(calls, 1, "metadata remains cached");
  now += 1;
  await readTokenData("assets");
  assert.equal(calls, 2, "metadata expires");
  now += 100;
  await readTokenData("prices/AAPL");
  now += 14999;
  await readTokenData("prices/AAPL");
  assert.equal(calls, 3);
  now += 1;
  fail = true;
  await assert.rejects(readTokenData("prices/AAPL"));
  await assert.rejects(readTokenData("prices/AAPL"));
  assert.equal(calls, 4, "failures have a short cooldown");
  now += 15000;
  fail = false;
  await readTokenData("prices/AAPL");
  assert.equal(calls, 5, "recovers after cooldown");
  await assert.rejects(readTokenData("../invalid"));
  assert.equal(calls, 5, "invalid paths never fetch");
  console.log("Token cache checks passed");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
