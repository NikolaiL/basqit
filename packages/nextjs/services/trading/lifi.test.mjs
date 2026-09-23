import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { encodeFunctionData, parseAbi } from "viem";

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith("./") && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { LIFI_DIAMOND, validateLifiQuote } = await import("./lifi.ts");
const { USDG } = await import("./quote.ts");

const stock = "0x6330D8C3178a418788dF01a47479c0ce7CCF450b";
const taker = "0x1111111111111111111111111111111111111111";
const maker = "0x2222222222222222222222222222222222222222";
const abi = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, SwapData[] swapData)",
  "struct FeeShare { address recipient; uint256 amount; }",
  "function forwardERC20Fees(address token, FeeShare[] fees)",
]);
const lifiWallet = "0x3333333333333333333333333333333333333333";
// shares: what the fee step forwards on chain; reported: LiFi's single combined fee line.
function quote({ receiver = taker, min = 995n, integrator = "", shares = [[lifiWallet, 5000n]], reported } = {}) {
  const feeCall = encodeFunctionData({
    abi,
    functionName: "forwardERC20Fees",
    args: [USDG, shares.map(([recipient, amount]) => ({ recipient, amount }))],
  });
  const total = shares.reduce((sum, [, amount]) => sum + amount, 0n);
  const data = encodeFunctionData({
    abi,
    functionName: "swapTokensMultipleV3ERC20ToERC20",
    args: [
      `0x${"ab".repeat(32)}`,
      integrator,
      "",
      receiver,
      min,
      [
        {
          callTo: maker,
          approveTo: maker,
          sendingAssetId: USDG,
          receivingAssetId: USDG,
          fromAmount: 2000000n,
          callData: feeCall,
          requiresDeposit: true,
        },
        {
          callTo: maker,
          approveTo: maker,
          sendingAssetId: USDG,
          receivingAssetId: stock,
          fromAmount: 1995000n,
          callData: "0x",
          requiresDeposit: false,
        },
      ],
    ],
  });
  return {
    toolDetails: { name: "Nordstern Finance" },
    action: {
      fromChainId: 4663,
      toChainId: 4663,
      fromToken: { address: USDG },
      toToken: { address: stock },
      fromAmount: "2000000",
      fromAddress: taker,
      toAddress: taker,
    },
    estimate: {
      approvalAddress: LIFI_DIAMOND,
      toAmount: "1000",
      toAmountMin: String(min),
      feeCosts: [
        { name: "LIFI Fixed Fee", amount: String(reported ?? total), token: { address: USDG }, included: true },
      ],
    },
    transactionRequest: { to: LIFI_DIAMOND, value: "0x0", chainId: 4663, data },
  };
}
const noFee = { bps: 0, recipient: null };
const run = (raw, overrides = {}) =>
  validateLifiQuote(
    raw,
    overrides.sell ?? USDG,
    overrides.buy ?? stock,
    overrides.amount ?? 2000000n,
    overrides.taker ?? taker,
    overrides.fee ?? noFee,
  );

const ok = run(quote());
assert.equal(ok.route, "Nordstern Finance");
assert.equal(ok.minBuyAmount, "995");
assert.deepEqual(ok.providerFee, { amount: "5000", token: USDG });
assert.equal(ok.basqitFee.amount, "0");
assert.equal(ok.transaction.to, LIFI_DIAMOND);

assert.throws(() => run(quote(), { taker: maker }), "quote for another wallet");
assert.throws(() => run(quote(), { amount: 3000000n }), "different amount");
assert.throws(() => run(quote(), { buy: USDG }), "different output token");
assert.throws(() => run(quote({ receiver: maker })), "calldata pays someone else");
assert.throws(() => run(quote({ min: 990n })), "slippage wider than 0.5%");
assert.throws(
  () => run({ ...quote(), transactionRequest: { ...quote().transactionRequest, to: maker } }),
  "unknown contract",
);
assert.throws(
  () => run({ ...quote(), transactionRequest: { ...quote().transactionRequest, value: "0x1" } }),
  "sends ETH",
);
assert.throws(() => run(quote({ shares: [[lifiWallet, 30000n]] })), "provider fee above 1%");

// Our share is read from the forwarded fees in calldata: our recipient, our exact amount, our integrator.
process.env.LIFI_INTEGRATOR = "basqit";
const fee = { bps: 15, recipient: taker };
const withOurs = [
  [lifiWallet, 5000n],
  [taker, 3000n],
];
assert.throws(() => run(quote(), { fee }), "fee requested but absent");
assert.throws(() => run(quote({ integrator: "other", shares: withOurs }), { fee }), "another integrator");
assert.throws(
  () =>
    run(
      quote({
        integrator: "basqit",
        shares: [
          [lifiWallet, 5000n],
          [maker, 3000n],
        ],
      }),
      { fee },
    ),
  "paid elsewhere",
);
assert.throws(
  () =>
    run(
      quote({
        integrator: "basqit",
        shares: [
          [lifiWallet, 5000n],
          [taker, 2000n],
        ],
      }),
      { fee },
    ),
  "short",
);
assert.throws(
  () => run(quote({ integrator: "basqit", shares: withOurs, reported: 7000n }), { fee }),
  "report mismatch",
);
const charged = run(quote({ integrator: "basqit", shares: withOurs }), { fee });
assert.equal(charged.basqitFee.amount, "3000");
assert.deepEqual(charged.providerFee, { amount: "5000", token: USDG });
console.log("LiFi quotes: pair, amount, receiver, minimum, contract and fees are enforced from calldata.");
