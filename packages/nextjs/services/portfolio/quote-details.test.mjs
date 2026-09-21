import { readQuoteDetails } from "./quote-details.ts";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return new Response(
    JSON.stringify({
      quotes: [{ tokenSymbol: "AAPL", currency: "USD", generatedAt: "2026-09-20T00:00:00Z", dailyHigh: "339.1" }],
    }),
  );
};
try {
  const [a, b] = await Promise.all([readQuoteDetails("AAPL"), readQuoteDetails("AAPL")]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await readQuoteDetails("AAPL");
  assert.equal(calls, 1);
  now += 60001;
  await readQuoteDetails("AAPL");
  assert.equal(calls, 2);
  await assert.rejects(readQuoteDetails("../bad"));
  assert.equal(calls, 2);
  now += 60001;
  globalThis.fetch = async () => {
    calls++;
    return new Response("outage", { status: 503 });
  };
  await assert.rejects(readQuoteDetails("AAPL"));
  await assert.rejects(readQuoteDetails("AAPL"));
  assert.equal(calls, 3);
  console.log("In-flight deduplication, TTL refresh, validation and failure cooldown passed.");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
