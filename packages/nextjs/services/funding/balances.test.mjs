import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./tokenLogos") return next("./tokenLogos.ts", context);
    return next(specifier, context);
  },
});
const { readFundingBalances } = await import("./balances.ts");

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalEnv = { ...process.env };
let now = originalNow(),
  calls = 0,
  fail = false;
Date.now = () => now;
const wallet = n => `0x${n.toString(16).padStart(40, "0")}`;
globalThis.fetch = async (url, options) => {
  calls++;
  const body = JSON.parse(options.body);
  assert.equal(body.addresses.length, 1);
  assert.equal(body.addresses[0].networks.length, 4);
  assert.equal(body.pageSize, undefined);
  if (fail) throw new Error(`private URL ${url}`);
  return Response.json({ data: { tokens: [], pageKey: "next" } });
};
try {
  process.env.NODE_ENV = "development";
  process.env.ALCHEMY_MULTICHAIN_API_KEY = "TEST_ONLY_SECRET";
  process.env.BASQIT_ENABLE_WALLET_SCAN = "false";
  assert.throws(() => readFundingBalances(wallet(1)), /not enabled/);
  process.env.BASQIT_ENABLE_WALLET_SCAN = "true";
  process.env.NODE_ENV = "production";
  assert.throws(() => readFundingBalances(wallet(1)), /not enabled/);
  process.env.NODE_ENV = "development";
  assert.throws(() => readFundingBalances("bad"), /Invalid wallet/);
  assert.equal(calls, 0);
  const data = await Promise.all(Array.from({ length: 20 }, () => readFundingBalances(wallet(1))));
  assert.equal(calls, 1);
  assert.equal(data[0].incomplete, true);
  assert.equal(data[0].nextPageKey, "next");
  assert.throws(() => readFundingBalances(wallet(2), "next"), /expired/);
  assert.throws(() => readFundingBalances(wallet(1), "invented"), /expired/);
  await Promise.all(Array.from({ length: 210 }, (_, i) => readFundingBalances(wallet(i + 2))));
  assert.equal(calls, 211, "scans have no minute, hour, daily or concurrency budget");
  now += 60000;
  fail = true;
  await assert.rejects(
    readFundingBalances(wallet(11)),
    error => error.message === "Wallet data is temporarily unavailable.",
  );
  await assert.rejects(readFundingBalances(wallet(11)));
  assert.equal(calls, 212, "errors cached; no retries");
  fail = false;
  await readFundingBalances(wallet(1));
  const beforePage = calls;
  await Promise.all([readFundingBalances(wallet(1), "next"), readFundingBalances(wallet(1), "next")]);
  assert.equal(calls, beforePage + 1, "next page deduplicates");
  console.log("Wallet scan guards, deduplication, unlimited scanning and secret-safe failures passed");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const name of ["NODE_ENV", "ALCHEMY_MULTICHAIN_API_KEY", "BASQIT_ENABLE_WALLET_SCAN"]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}
