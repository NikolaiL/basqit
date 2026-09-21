import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, parseEther } from "viem";

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith("./") && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { combineBuys, splitAmount } = await import("./batch.ts");
const { USDG } = await import("./quote.ts");
const { V3_ROUTER, V3_QUOTER, v3Abi, directCalldata } = await import("./uniswap.ts");
const account = "0x4b7b07d8baf51975eeab0e1eb4b481a5ac691ed6";
const recipient = "0x1111111111111111111111111111111111111111";
const fee = { bps: 10, recipient };
assert.deepEqual(splitAmount(10000001n, 3), [3333334n, 3333334n, 3333333n]);
assert.throws(() => splitAmount(1n, 2));
assert.throws(() => splitAmount(100n, 9));
function leg(token, data = directCalldata(USDG, token, account, 1000000n, 1n, 500, 123456789n, fee)) {
  return {
    provider: "uniswap",
    spender: V3_ROUTER,
    sellToken: USDG,
    buyToken: token,
    sellAmount: "1000000",
    sellDecimals: 6,
    buyDecimals: 18,
    taker: account,
    balance: "10000000",
    allowance: "0",
    expiresAt: Date.now() + 30000,
    transaction: { to: V3_ROUTER, value: "0", data },
  };
}
const a = leg("0x0000000000000000000000000000000000000001");
const b = leg("0x0000000000000000000000000000000000000002");
const batch = combineBuys([a, b]);
assert.equal(batch.sellAmount, "2000000");
assert.equal(decodeFunctionData({ abi: v3Abi, data: batch.transaction.data }).args[1].length, 4);
assert.throws(() => combineBuys([a, a]));
assert.throws(() => combineBuys([a, { ...b, taker: recipient }]));
assert.throws(() => combineBuys([{ ...a, balance: "1" }, b]));
assert.throws(() => combineBuys([{ ...a, expiresAt: 0 }, b]));
assert.throws(() => combineBuys([{ ...a, transaction: { ...a.transaction, to: recipient } }, b]));
console.log("Batch allocation, bounds, totals and fee calls passed");
if (process.argv.includes("--fork")) {
  const client = createPublicClient({ transport: http("http://127.0.0.1:8557") });
  assert.match(await client.request({ method: "web3_clientVersion" }), /anvil/i);
  await client.request({ method: "anvil_impersonateAccount", params: [account] });
  await client.request({ method: "anvil_setBalance", params: [account, "0x" + parseEther("1").toString(16)] });
  const chain = {
    id: await client.getChainId(),
    name: "Local fork",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8557"] } },
  };
  const wallet = createWalletClient({ account, chain, transport: http("http://127.0.0.1:8557") });
  const assets = (await (await fetch("https://api.robinhood.com/rhj/assets")).json()).assets;
  const tokens = ["AAPL", "NVDA"].map(
    symbol => assets.find(a => a.tokenSymbol === symbol).deployments.find(d => d.chainId === 4663).contractAddress,
  );
  const balance = (token, owner = account) =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const beforeUsd = await balance(USDG);
  const before = await Promise.all(tokens.map(t => balance(t)));
  const beforeFees = await Promise.all(tokens.map(t => balance(t, recipient)));
  const approval = await wallet.writeContract({
    address: USDG,
    abi: erc20Abi,
    functionName: "approve",
    args: [V3_ROUTER, 4000000n],
  });
  await client.waitForTransactionReceipt({ hash: approval });
  const block = await client.getBlock();
  const legs = await Promise.all(
    tokens.map(async token => {
      const {
        result: [output],
      } = await client.simulateContract({
        address: V3_QUOTER,
        abi: v3Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDG, tokenOut: token, amountIn: 1000000n, fee: 500, sqrtPriceLimitX96: 0n }],
      });
      const minimum = (output * 9950n) / 10000n;
      return {
        ...leg(token, directCalldata(USDG, token, account, 1000000n, minimum, 500, block.timestamp + 120n, fee)),
        fee: 500,
        minBuyAmount: String(minimum - (minimum * 10n) / 10000n),
        balance: String(beforeUsd),
      };
    }),
  );
  // Quote fixtures share an unchanged fork state; wall-clock RPC latency is not part of this execution test.
  for (const item of legs) item.expiresAt = Date.now() + 30000;
  const combined = combineBuys(legs);
  const gas = await client.estimateGas({ account, to: V3_ROUTER, data: combined.transaction.data, value: 0n });
  const hash = await wallet.sendTransaction({
    to: V3_ROUTER,
    data: combined.transaction.data,
    value: 0n,
    gas: (gas * 120n) / 100n,
  });
  assert.equal((await client.waitForTransactionReceipt({ hash })).status, "success");
  assert.equal(beforeUsd - (await balance(USDG)), 2000000n);
  for (let i = 0; i < tokens.length; i++) {
    assert.ok((await balance(tokens[i])) - before[i] >= BigInt(legs[i].minBuyAmount));
    assert.ok((await balance(tokens[i], recipient)) > beforeFees[i]);
    assert.equal(await balance(tokens[i], V3_ROUTER), 0n);
  }
  const after = await Promise.all([
    balance(USDG),
    ...tokens.map(t => balance(t)),
    ...tokens.map(t => balance(t, recipient)),
  ]);
  const awaitBlockTimestamp = (await client.getBlock()).timestamp;
  const bad = legs.map((l, i) =>
    i === 1
      ? {
          ...l,
          transaction: {
            ...l.transaction,
            data: directCalldata(
              USDG,
              tokens[i],
              account,
              1000000n,
              2n ** 200n,
              l.fee,
              awaitBlockTimestamp + 120n,
              fee,
            ),
          },
        }
      : l,
  );
  const failed = await wallet.sendTransaction({
    to: V3_ROUTER,
    data: combineBuys(bad).transaction.data,
    value: 0n,
    gas: 1500000n,
  });
  assert.equal((await client.waitForTransactionReceipt({ hash: failed })).status, "reverted");
  assert.deepEqual(
    await Promise.all([balance(USDG), ...tokens.map(t => balance(t)), ...tokens.map(t => balance(t, recipient))]),
    after,
  );
  await client.request({ method: "anvil_stopImpersonatingAccount", params: [account] });
  console.log("Local fork: two-stock atomic purchase, fees and rollback of first swap after second fails passed");
}
