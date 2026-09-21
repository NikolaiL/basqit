import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {}
    }
    return next(specifier, context);
  },
});
const { fundingTokens, parseFundingInput, terminalStatus, NATIVE } = await import("./shared.ts");
const { getFundingQuote } = await import("./provider.ts");
const { USDG, ALLOWANCE_HOLDER } = await import("../trading/quote.ts");
const wallet = "0x4b7b07d8baf51975eeab0e1eb4b481a5ac691ed6",
  token = "0x4200000000000000000000000000000000000006";
const params = () => new URLSearchParams({ wallet, token, chainId: "8453", amount: "10000000000000000" });
for (const [key, value] of [
  ["wallet", "bad"],
  ["token", "0x" + "0".repeat(40)],
  ["chainId", "4663"],
  ["amount", "-1"],
  ["amount", (2n ** 256n).toString()],
  ["amount", "1.1"],
]) {
  const p = params();
  p.set(key, value);
  assert.throws(() => parseFundingInput(p));
}
const duplicate = params();
duplicate.append("wallet", wallet);
assert.throws(() => parseFundingInput(duplicate));
const native = {
  network: "base-mainnet",
  tokenAddress: null,
  tokenBalance: "0xde0b6b3a7640000",
  tokenMetadata: { decimals: null, symbol: null },
  tokenPrices: [{ currency: "usd", value: "2700" }],
};
assert.deepEqual(
  fundingTokens([
    native,
    native,
    { ...native, error: "failed" },
    { ...native, network: "unknown" },
    { ...native, tokenBalance: "bad" },
    { ...native, tokenPrices: [] },
  ]),
  [{ chainId: 8453, address: NATIVE, decimals: 18, symbol: "ETH", balance: "1000000000000000000", usd: 2700 }],
);
assert.equal(terminalStatus({ status: "bridge_failed", failure: { status: "refund_pending" } }), false);
assert.equal(terminalStatus({ status: "bridge_failed", failure: { status: "manual_action_required" } }), false);
for (const status of ["refund_succeeded", "no_actions_required", "failed"])
  assert.equal(terminalStatus({ status: "bridge_failed", failure: { status } }), true);
assert.equal(terminalStatus({ status: "bridge_filled" }), true);
assert.equal(terminalStatus({ status: "origin_tx_confirmed" }), false);
const env = { ...process.env },
  fetchBefore = globalThis.fetch,
  nowBefore = Date.now;
let now = 100000,
  calls = 0,
  modify = x => x;
Date.now = () => now;
function response() {
  return {
    liquidityAvailable: true,
    originChainId: 8453,
    destinationChainId: 4663,
    sellToken: token,
    buyToken: USDG,
    allowanceTarget: ALLOWANCE_HOLDER,
    quotes: [
      {
        sellAmount: "10000000000000000",
        buyAmount: "27000000",
        minBuyAmount: "26000000",
        quoteId: "0x1234",
        issues: { simulationIncomplete: false, balance: null },
        transaction: { chainType: "evm", details: { to: ALLOWANCE_HOLDER, data: "0x1234", value: "0" } },
        steps: [{ type: "bridge", provider: "across_v4" }],
      },
    ],
  };
}
globalThis.fetch = async (url, opts) => {
  calls++;
  const u = new URL(url);
  assert.equal(u.searchParams.get("buyToken"), USDG);
  assert.equal(u.searchParams.get("destinationAddress"), wallet);
  assert.equal(u.searchParams.get("destinationChain"), "4663");
  assert.equal(opts.headers["0x-api-key"], "test");
  return Response.json(modify(response()));
};
try {
  process.env.NODE_ENV = "development";
  process.env.BASQIT_ENABLE_FUNDING = "true";
  process.env.ZEROX_API_KEY = "test";
  const first = await getFundingQuote(params());
  assert.equal(first.buyAmount, "27000000");
  assert.equal(first.expiresAt, 130000);
  now += 1000;
  assert.equal((await getFundingQuote(params())).expiresAt, 130000, "cache must not extend executable expiry");
  assert.equal(calls, 1);
  for (const change of [
    d => ({ ...d, destinationChainId: 1 }),
    d => ({ ...d, buyToken: token }),
    d => ({ ...d, allowanceTarget: wallet }),
    d => ({ ...d, quotes: [{ ...d.quotes[0], sellAmount: "1" }] }),
    d => ({ ...d, quotes: [{ ...d.quotes[0], issues: { simulationIncomplete: true } }] }),
  ]) {
    globalThis.basqitFundingProvider.cache.clear();
    modify = change;
    await assert.rejects(getFundingQuote(params()));
  }
  process.env.NODE_ENV = "production";
  await assert.rejects(getFundingQuote(params()), /not enabled/);
  console.log(
    "Funding validation, native metadata, spam filters, recovery states, destination binding, spender and expiry checks passed",
  );
} finally {
  globalThis.fetch = fetchBefore;
  Date.now = nowBefore;
  for (const key of ["NODE_ENV", "BASQIT_ENABLE_FUNDING", "ZEROX_API_KEY"]) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}
