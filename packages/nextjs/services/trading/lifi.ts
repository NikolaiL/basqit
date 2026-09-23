import { SLIPPAGE_BPS, type SwapFee, TRADE_CHAIN } from "./quote";
import { type Address, decodeFunctionData, parseAbi } from "viem";

// LiFi Diamond on chain 4663: `diamondAddress` from li.quest/v1/chains, verified to hold code onchain.
export const LIFI_DIAMOND = "0xB477751B76CF82d00a686A1232f5fCD772414Af3" as const;
// LiFi's own fee is 0.25% today; anything above this cap is rejected rather than shown.
const MAX_PROVIDER_FEE_BPS = 100;

const swapAbi = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensSingleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, SwapData swapData)",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, SwapData[] swapData)",
]);
// First swap step when a fee is set: LiFi forwards each fee share straight to its recipient.
const feeAbi = parseAbi([
  "struct FeeShare { address recipient; uint256 amount; }",
  "function forwardERC20Fees(address token, FeeShare[] fees)",
]);

const uint = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,78}$/.test(value) && BigInt(value) < 2n ** 256n;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * LiFi routes RFQ makers and propAMMs (Nordstern, Rialto, KyberSwap…) that direct pools miss.
 * The route is trusted; the pair, amount, receiver, minimum and contract are checked in the calldata itself.
 */
export function validateLifiQuote(
  raw: unknown,
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  taker: Address,
  fee: SwapFee,
) {
  const q = raw as Record<string, any> | null;
  const action = q?.action;
  const estimate = q?.estimate;
  const tx = q?.transactionRequest;
  if (
    !q ||
    action?.fromChainId !== TRADE_CHAIN ||
    action?.toChainId !== TRADE_CHAIN ||
    !same(action?.fromToken?.address, sellToken) ||
    !same(action?.toToken?.address, buyToken) ||
    action?.fromAmount !== String(sellAmount) ||
    !same(action?.fromAddress, taker) ||
    !same(action?.toAddress, taker) ||
    !same(estimate?.approvalAddress, LIFI_DIAMOND) ||
    !uint(estimate?.toAmount) ||
    !uint(estimate?.toAmountMin) ||
    BigInt(estimate.toAmountMin) <= 0n ||
    BigInt(estimate.toAmountMin) > BigInt(estimate.toAmount) ||
    BigInt(estimate.toAmountMin) < (BigInt(estimate.toAmount) * BigInt(10000 - SLIPPAGE_BPS)) / 10000n ||
    !same(tx?.to, LIFI_DIAMOND) ||
    tx?.chainId !== TRADE_CHAIN ||
    typeof tx?.value !== "string" ||
    !/^0x[0-9a-fA-F]{0,64}$/.test(tx.value) ||
    BigInt(tx.value) !== 0n ||
    typeof tx?.data !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(tx.data) ||
    tx.data.length % 2 !== 0 ||
    tx.data.length > 200000
  )
    throw new Error("No supported executable LiFi quote is available.");
  const decoded = decodeFunctionData({ abi: swapAbi, data: tx.data as `0x${string}` });
  const [, integrator, , receiver, minAmountOut, swapData] = decoded.args;
  const swaps = Array.isArray(swapData) ? swapData : [swapData];
  if (
    !same(receiver, taker) ||
    minAmountOut !== BigInt(estimate.toAmountMin) ||
    !swaps.length ||
    !same(swaps[0].sendingAssetId, sellToken) ||
    swaps[0].fromAmount !== sellAmount ||
    !same(swaps[swaps.length - 1].receivingAssetId, buyToken)
  )
    throw new Error("LiFi calldata does not match the requested trade.");
  const fees = Array.isArray(estimate.feeCosts) ? estimate.feeCosts : [];
  let reported = 0n;
  for (const cost of fees) {
    if (!uint(cost?.amount) || !same(cost?.token?.address, sellToken) || cost?.included !== true)
      throw new Error("Unexpected LiFi fee.");
    reported += BigInt(cost.amount);
  }
  // LiFi reports one combined fee line; the calldata says who receives what, so our share is read from it.
  let ours = 0n;
  let providerTotal = reported;
  if (fee.bps > 0) {
    const expected = (sellAmount * BigInt(fee.bps)) / 10000n;
    let shares: readonly { recipient: Address; amount: bigint }[] = [];
    try {
      const forwarded = decodeFunctionData({ abi: feeAbi, data: swaps[0].callData });
      if (!same(forwarded.args[0], sellToken)) throw new Error();
      shares = forwarded.args[1];
    } catch {
      throw new Error("LiFi quote does not include the Basqit fee.");
    }
    const mine = shares.filter(share => same(share.recipient, fee.recipient!));
    const total = shares.reduce((sum, share) => sum + share.amount, 0n);
    if (
      integrator !== process.env.LIFI_INTEGRATOR ||
      mine.length !== 1 ||
      mine[0].amount < expected - 1n ||
      mine[0].amount > expected + 1n ||
      total !== reported
    )
      throw new Error("LiFi quote does not include the Basqit fee.");
    ours = mine[0].amount;
    providerTotal = total - ours;
  }
  if (providerTotal > (sellAmount * BigInt(MAX_PROVIDER_FEE_BPS)) / 10000n) throw new Error("Unexpected LiFi fee.");
  return {
    route: typeof q.toolDetails?.name === "string" ? (q.toolDetails.name as string).slice(0, 40) : "LiFi",
    buyAmount: estimate.toAmount as string,
    minBuyAmount: estimate.toAmountMin as string,
    basqitFee: { ...fee, amount: String(ours), token: sellToken },
    providerFee: providerTotal > 0n ? { amount: String(providerTotal), token: sellToken } : undefined,
    transaction: { to: LIFI_DIAMOND, data: tx.data as `0x${string}`, value: "0" },
  };
}

/** Our fee is only charged through LiFi once the integrator is registered for payouts (LIFI_INTEGRATOR). */
export function lifiFee(fee: SwapFee): SwapFee {
  return process.env.LIFI_INTEGRATOR && fee.bps > 0 ? fee : { bps: 0, recipient: null };
}

export async function quoteLifi(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  taker: Address,
  fee: SwapFee,
) {
  const params = new URLSearchParams({
    fromChain: String(TRADE_CHAIN),
    toChain: String(TRADE_CHAIN),
    fromToken: sellToken,
    toToken: buyToken,
    fromAmount: String(sellAmount),
    fromAddress: taker,
    toAddress: taker,
    slippage: String(SLIPPAGE_BPS / 10000),
  });
  if (fee.bps > 0) {
    params.set("integrator", process.env.LIFI_INTEGRATOR!);
    params.set("fee", String(fee.bps / 10000));
  }
  const response = await fetch(`https://li.quest/v1/quote?${params}`, {
    headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "LiFi is busy." : "No LiFi route.");
  return validateLifiQuote(await response.json(), sellToken, buyToken, sellAmount, taker, fee);
}
