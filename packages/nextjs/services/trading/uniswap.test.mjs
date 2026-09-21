import { V3_ROUTER, directCalldata, quoteDirect, v3Abi } from "./uniswap.ts";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, parseEther } from "viem";

const usd = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const stock = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
const feeRecipient = "0x1111111111111111111111111111111111111111";
const feeConfig = { bps: 10, recipient: feeRecipient };
const account = "0x4b7b07d8baf51975eeab0e1eb4b481a5ac691ed6";
const decoded = decodeFunctionData({
  abi: v3Abi,
  data: directCalldata(usd, stock, account, 5000000n, 100n, 500, 1234n),
});
assert.equal(decoded.functionName, "multicall");
assert.equal(decoded.args[0], 1234n);
const swap = decodeFunctionData({ abi: v3Abi, data: decoded.args[1][0] });
assert.equal(swap.args[0].recipient.toLowerCase(), account);
assert.equal(swap.args[0].amountOutMinimum, 100n);
assert.equal(swap.args[0].amountIn, 5000000n);
assert.throws(() => directCalldata(usd, stock, account, 1n, 0n, 500, 1234n));
console.log("Direct calldata bounds and deadline passed.");

const withFee = decodeFunctionData({
  abi: v3Abi,
  data: directCalldata(usd, stock, account, 5000000n, 1000n, 500, 1234n, feeConfig),
});
assert.equal(withFee.args[1].length, 2);
const feeSwap = decodeFunctionData({ abi: v3Abi, data: withFee.args[1][0] });
assert.equal(feeSwap.args[0].recipient.toLowerCase(), V3_ROUTER);
const sweep = decodeFunctionData({ abi: v3Abi, data: withFee.args[1][1] });
assert.equal(sweep.functionName, "sweepTokenWithFee");
assert.deepEqual(
  sweep.args.map(v => (typeof v === "string" ? v.toLowerCase() : v)),
  [stock.toLowerCase(), 1000n, account, 10n, feeRecipient],
);
assert.throws(() => directCalldata(usd, stock, account, 1n, 1n, 500, 1234n, { bps: 101, recipient: feeRecipient }));
console.log("Atomic fee calldata recipient, rate and minimum passed.");

if (process.argv.includes("--fork")) {
  // Local-only endpoint: impersonation and transactions must never reach a public RPC.
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
  const balance = (token, owner = account) =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  async function execute(tokenIn, tokenOut, amountIn, fee = feeConfig) {
    let quote = await quoteDirect(client, tokenIn, tokenOut, amountIn, account, fee);
    const beforeFee = await balance(tokenOut, feeRecipient);
    const beforeIn = await balance(tokenIn),
      beforeOut = await balance(tokenOut);
    assert.ok(beforeIn >= amountIn, "Fork wallet needs sufficient input tokens");
    const approval = await wallet.writeContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: "approve",
      args: [V3_ROUTER, amountIn],
    });
    assert.equal((await client.waitForTransactionReceipt({ hash: approval })).status, "success");
    quote = await quoteDirect(client, tokenIn, tokenOut, amountIn, account, fee);
    const gas = await client.estimateGas({
      account,
      to: quote.transaction.to,
      data: quote.transaction.data,
      value: 0n,
    });
    const hash = await wallet.sendTransaction({
      to: quote.transaction.to,
      data: quote.transaction.data,
      value: 0n,
      gas: (gas * 120n) / 100n,
    });
    assert.equal((await client.waitForTransactionReceipt({ hash })).status, "success");
    const received = (await balance(tokenOut)) - beforeOut;
    assert.equal(beforeIn - (await balance(tokenIn)), amountIn);
    assert.ok(received >= BigInt(quote.minBuyAmount));
    const feeReceived = (await balance(tokenOut, feeRecipient)) - beforeFee;
    assert.equal(feeReceived, ((received + feeReceived) * BigInt(fee.bps)) / 10000n);
    assert.equal(feeReceived, BigInt(quote.basqitFee.amount));
    assert.equal(received, BigInt(quote.buyAmount));
    assert.equal(await balance(tokenOut, V3_ROUTER), 0n);
    // A failed swap must not pay a fee or spend the input.
    const failedHash = await wallet.sendTransaction({
      to: V3_ROUTER,
      data: directCalldata(
        tokenIn,
        tokenOut,
        account,
        1n,
        2n ** 200n,
        quote.fee,
        (await client.getBlock()).timestamp + 120n,
        fee,
      ),
      value: 0n,
      gas: 500000n,
    });
    assert.equal((await client.waitForTransactionReceipt({ hash: failedHash })).status, "reverted");
    assert.equal(await balance(tokenOut, feeRecipient), beforeFee + feeReceived);
    console.log(
      JSON.stringify({
        direction: tokenIn === usd ? "buy" : "sell",
        received: String(received),
        feeReceived: String(feeReceived),
        feeBps: fee.bps,
        minBuyAmount: quote.minBuyAmount,
        pool: quote.pool,
        fee: quote.fee,
        impactBps: quote.impactBps,
      }),
    );
    return received;
  }
  const received = await execute(usd, stock, 5000000n);
  await execute(stock, usd, received);
  const withoutFee = await execute(usd, stock, 1000000n, { bps: 0, recipient: null });
  await execute(stock, usd, withoutFee, { bps: 100, recipient: feeRecipient });
  await client.request({ method: "anvil_stopImpersonatingAccount", params: [account] });
  console.log("Local fork buy and sell passed; no public transactions submitted.");
}
