import type { SwapFee } from "./quote";
import { type Address, type PublicClient, encodeFunctionData, parseAbi } from "viem";

// Official Uniswap deployments, verified against factory() on chain 4663.
export const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
export const V3_ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2" as const;
export const V3_QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" as const;
export const v3Abi = parseAbi([
  "function factory() view returns (address)",
  "function getPool(address,address,uint24) view returns (address)",
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
  "function sweepTokenWithFee(address token,uint256 amountMinimum,address recipient,uint256 feeBips,address feeRecipient) payable",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
]);

export function directCalldata(
  tokenIn: Address,
  tokenOut: Address,
  recipient: Address,
  amountIn: bigint,
  minimum: bigint,
  fee: number,
  deadline: bigint,
  basqitFee: SwapFee = { bps: 0, recipient: null },
) {
  if (amountIn <= 0n || minimum <= 0n) throw new Error("Trade amount is too small.");
  if (
    !Number.isInteger(basqitFee.bps) ||
    basqitFee.bps < 0 ||
    basqitFee.bps > 100 ||
    (basqitFee.bps > 0 && (!basqitFee.recipient || /^0x0{40}$/i.test(basqitFee.recipient)))
  )
    throw new Error("Invalid Basqit fee.");
  const swap = encodeFunctionData({
    abi: v3Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient: basqitFee.bps > 0 ? V3_ROUTER : recipient,
        amountIn,
        amountOutMinimum: minimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const calls = [swap];
  if (basqitFee.bps > 0)
    calls.push(
      encodeFunctionData({
        abi: v3Abi,
        functionName: "sweepTokenWithFee",
        args: [tokenOut, minimum, recipient, BigInt(basqitFee.bps), basqitFee.recipient!],
      }),
    );
  return encodeFunctionData({ abi: v3Abi, functionName: "multicall", args: [deadline, calls] });
}

export async function quoteDirect(
  client: PublicClient,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  basqitFee: SwapFee = { bps: 0, recipient: null },
) {
  const block = await client.getBlock();
  const [routerFactory, quoterFactory] = await Promise.all([
    client.readContract({ address: V3_ROUTER, abi: v3Abi, functionName: "factory", blockNumber: block.number }),
    client.readContract({ address: V3_QUOTER, abi: v3Abi, functionName: "factory", blockNumber: block.number }),
  ]);
  if ([routerFactory, quoterFactory].some(a => a.toLowerCase() !== V3_FACTORY))
    throw new Error("DEX configuration verification failed.");
  // ponytail: four direct pools only; add multihop routing when direct USDG liquidity is insufficient.
  const candidates = await Promise.allSettled(
    [100, 500, 3000, 10000].map(async fee => {
      const pool = await client.readContract({
        address: V3_FACTORY,
        abi: v3Abi,
        functionName: "getPool",
        args: [tokenIn, tokenOut, fee],
        blockNumber: block.number,
      });
      if (/^0x0{40}$/i.test(pool)) throw new Error("No pool");
      const [
        {
          result: [amountOut],
        },
        [sqrtPrice],
      ] = await Promise.all([
        client.simulateContract({
          address: V3_QUOTER,
          abi: v3Abi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
          blockNumber: block.number,
        }),
        client.readContract({ address: pool, abi: v3Abi, functionName: "slot0", blockNumber: block.number }),
      ]);
      const square = sqrtPrice * sqrtPrice;
      const spotOut =
        tokenIn.toLowerCase() < tokenOut.toLowerCase()
          ? (amountIn * square) / 2n ** 192n
          : (amountIn * 2n ** 192n) / square;
      const impactBps = spotOut > amountOut ? Number(((spotOut - amountOut) * 10000n) / spotOut) : 0;
      if (amountOut <= 0n || impactBps > 500) throw new Error("Insufficient liquidity");
      return { amountOut, fee, pool, impactBps };
    }),
  );
  const routes = candidates.flatMap(r => (r.status === "fulfilled" ? [r.value] : []));
  const best = routes.sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))[0];
  if (!best)
    throw new Error(
      "No usable direct USDG pool was found, or price impact exceeds 5%. Try a smaller amount or retry later.",
    );
  const minimum = (best.amountOut * 9950n) / 10000n;
  return {
    buyAmount: String(best.amountOut - (best.amountOut * BigInt(basqitFee.bps)) / 10000n),
    minBuyAmount: String(minimum - (minimum * BigInt(basqitFee.bps)) / 10000n),
    basqitFee: { ...basqitFee, token: tokenOut, amount: String((best.amountOut * BigInt(basqitFee.bps)) / 10000n) },
    pool: best.pool,
    impactBps: best.impactBps,
    fee: best.fee,
    transaction: {
      to: V3_ROUTER,
      value: "0",
      data: directCalldata(
        tokenIn,
        tokenOut,
        recipient,
        amountIn,
        minimum,
        best.fee,
        block.timestamp + 120n,
        basqitFee,
      ),
    },
  };
}
