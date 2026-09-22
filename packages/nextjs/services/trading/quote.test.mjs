import { ALLOWANCE_HOLDER, USDG, quoteError, validateQuote } from "./quote.ts";
import assert from "node:assert/strict";
import { encodeAbiParameters } from "viem";

const token = "0x1111111111111111111111111111111111111111";
const calldata = (amount = 1000000n, sellToken = USDG) =>
  "0x2213bc0b" +
  encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes" }],
    [token, sellToken, amount, token, "0x1234"],
  ).slice(2);
const valid = {
  liquidityAvailable: true,
  sellToken: USDG,
  buyToken: token,
  sellAmount: "1000000",
  buyAmount: "1000",
  minBuyAmount: "995",
  allowanceTarget: ALLOWANCE_HOLDER,
  issues: { allowance: { spender: ALLOWANCE_HOLDER } },
  transaction: { to: ALLOWANCE_HOLDER, value: "0", data: calldata() },
};
const check = q => validateQuote(q, USDG, token, "1000000");
assert.equal(check(valid).minBuyAmount, "995");
assert.equal(check({ ...valid, buyAmount: "1001", minBuyAmount: "995" }).minBuyAmount, "995");
for (const patch of [
  { transaction: { ...valid.transaction, data: calldata(2n) } },
  { transaction: { ...valid.transaction, data: calldata(1000000n, token) } },
  { transaction: { ...valid.transaction, data: "0x2213bc0b00" } },
  { sellToken: token },
  { buyToken: USDG },
  { sellAmount: "2000000" },
  { liquidityAvailable: false },
  { buyAmount: "invalid" },
  { minBuyAmount: "0" },
  { minBuyAmount: "994" },
  { minBuyAmount: "1001" },
  { allowanceTarget: token },
  { issues: { allowance: { spender: token } } },
  { transaction: { ...valid.transaction, to: token } },
  { transaction: { ...valid.transaction, value: "1" } },
  { transaction: { ...valid.transaction, data: "0xdeadbeef00" } },
  { transaction: { ...valid.transaction, data: "0x2213bc0b0" } },
])
  assert.throws(() => check({ ...valid, ...patch }));
assert.throws(() => check(null));
console.log("Trade quote validation passed: pair, amount, slippage, spender, target and transaction value.");

for (const name of ["BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE", "SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE"]) {
  assert.equal(quoteError(422, name).status, 403);
  assert.match(quoteError(422, name).error, /legal restrictions/);
}
assert.match(quoteError(401).error, /credentials or permissions/);
assert.match(quoteError(429).error, /busy/);
assert.match(quoteError(500, "unknown").error, /No swap route/);
console.log("Quote provider error handling passed.");

const { balancePercentage } = await import("./quote.ts");
assert.equal(balancePercentage(1234567n, 6, 50), "0.617283");
assert.equal(balancePercentage(1234567890123456789n, 18, 100), "1.234567890123456789");
assert.equal(balancePercentage(1234567n, 6, 0), "0");
assert.equal(balancePercentage(0n, 18, 50), "0");
assert.equal(balancePercentage(1n, 18, 50), "0");
assert.throws(() => balancePercentage(1n, 18, 101));
console.log("Balance percentage: exact full balance, rounded-down half, zero and limits passed.");

const { swapFeeConfig } = await import("./quote.ts");
assert.deepEqual(swapFeeConfig(undefined, token), { bps: 10, recipient: token });
assert.deepEqual(swapFeeConfig("0"), { bps: 0, recipient: null });
assert.equal(swapFeeConfig("100", token).bps, 100);
for (const bps of ["", "0.1", "-1", "101", "NaN"]) assert.throws(() => swapFeeConfig(bps, token));
assert.throws(() => swapFeeConfig("10"));
assert.throws(() => swapFeeConfig("10", "0x0000000000000000000000000000000000000000"));
const feeConfig = swapFeeConfig("10", token);
const feeQuote = { ...valid, buyAmount: "999", minBuyAmount: "995", fees: { integratorFee: { amount: "1", token } } };
assert.equal(validateQuote(feeQuote, USDG, token, "1000000", feeConfig).buyAmount, "999");
assert.equal(validateQuote(feeQuote, USDG, token, "1000000", feeConfig).basqitFee.amount, "1");
assert.throws(() => validateQuote(valid, USDG, token, "1000000", feeConfig));
assert.throws(() => check(feeQuote));
for (const patch of [{ amount: "100" }, { token: USDG }, { amount: "-1" }, { recipient: USDG }]) {
  assert.throws(() =>
    validateQuote(
      { ...feeQuote, fees: { integratorFee: { ...feeQuote.fees.integratorFee, ...patch } } },
      USDG,
      token,
      "1000000",
      feeConfig,
    ),
  );
}
assert.equal(
  validateQuote(
    { ...feeQuote, fees: { integratorFees: [feeQuote.fees.integratorFee] } },
    USDG,
    token,
    "1000000",
    feeConfig,
  ).basqitFee.amount,
  "1",
);
console.log("Fee configuration and 0x fee response validation passed.");

const liveFeeShape = {
  ...valid,
  buyAmount: "2668131",
  minBuyAmount: "2654790",
  fees: { integratorFee: { amount: "2675", token }, zeroExFee: { amount: "4012", token } },
};
assert.equal(validateQuote(liveFeeShape, USDG, token, "1000000", feeConfig).providerFee.amount, "4012");

assert.equal(balancePercentage(1000000000856277211610700n, 18, 50, 8), "500000.00042813");
assert.equal(balancePercentage(1234567n, 6, 50, 8), "0.617283");
assert.equal(balancePercentage(1234567890123456789n, 18, 100, 8), "1.23456789");
assert.equal(balancePercentage(9999999999n, 18, 100, 8), "0");
assert.equal(balancePercentage(123n, 2, 50, 8), "0.61");
assert.throws(() => balancePercentage(1n, 18, 50, -1));
