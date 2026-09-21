import { readFundingBalances } from "./balances.ts";
import assert from "node:assert/strict";

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
  const first = readFundingBalances(wallet(2));
  const second = readFundingBalances(wallet(3));
  assert.throws(
    () => readFundingBalances(wallet(4)),
    error => error.status === 429,
  );
  await Promise.all([first, second]);
  for (let n = 4; n <= 10; n++) await readFundingBalances(wallet(n));
  assert.throws(
    () => readFundingBalances(wallet(11)),
    error => error.status === 429,
  );
  assert.equal(calls, 10);
  now += 60000;
  fail = true;
  await assert.rejects(
    readFundingBalances(wallet(11)),
    error => error.message === "Wallet data is temporarily unavailable.",
  );
  await assert.rejects(readFundingBalances(wallet(11)));
  assert.equal(calls, 11, "errors cached; no retries");
  fail = false;
  for (let minute = 0; minute < 5; minute++) {
    now += 60000;
    for (let i = 0; i < 10; i++) {
      if (calls === 60) break;
      await readFundingBalances(wallet(100 + minute * 10 + i));
    }
  }
  assert.equal(calls, 60);
  now += 60000;
  assert.throws(
    () => readFundingBalances(wallet(500)),
    error => error.status === 429,
  );
  assert.equal(calls, 60, "hour budget cannot be bypassed with different wallets");
  let id = 1000;
  while (calls < 200) {
    now += 3600000;
    for (let minute = 0; minute < 6 && calls < 200; minute++) {
      now += 60000;
      for (let request = 0; request < 10 && calls < 200; request++) await readFundingBalances(wallet(id++));
    }
  }
  now += 3600000;
  assert.throws(
    () => readFundingBalances(wallet(id)),
    error => error.status === 429,
  );
  assert.equal(calls, 200, "daily upstream cap enforced");
  now += 86400000;
  await readFundingBalances(wallet(1));
  const beforePage = calls;
  await Promise.all([readFundingBalances(wallet(1), "next"), readFundingBalances(wallet(1), "next")]);
  assert.equal(calls, beforePage + 1, "next page deduplicates and consumes budget");
  console.log("Wallet scan guards, deduplication, bounds, budgets and secret-safe failures passed");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const name of ["NODE_ENV", "ALCHEMY_MULTICHAIN_API_KEY", "BASQIT_ENABLE_WALLET_SCAN"]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}
