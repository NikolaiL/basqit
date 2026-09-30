import { ALLOWANCE_HOLDER, swapFeeConfig } from "../trading/quote";
import { ScanError } from "./balances";
import { type FundingQuote, NATIVE, fundingDestinations, parseFundingInput } from "./shared";

// ponytail: calibration knobs, not verified protocol limits. The 0x cross-chain transaction target is not
// independently verified, so the payload is bounded instead: native value, target and output tolerance.
// Native bridge fee a route may add on top of the input (0x documents such fees); shown to the buyer.
export const MAX_FUNDING_NATIVE_FEE = 5_000_000_000_000_000n; // 0.005 ETH
// Largest gap between expected and minimum output the buyer can be asked to accept.
export const MAX_FUNDING_SLIPPAGE_BPS = 500n;

// ponytail: per-process budget; move to a shared limiter if paid 0x usage grows or more instances run.
// Quotes and status have separate capacity (same 60/min, 4 concurrent in total), so quote traffic can never use up
// the status checks that transfer recovery depends on.
const LIMITS = { quotes: { perMinute: 40, active: 3 }, status: { perMinute: 20, active: 1 } } as const;
type Budget = { start: number; count: number; active: number };
const globals = globalThis as typeof globalThis & {
  basqitFundingProvider?: {
    budgets: Record<keyof typeof LIMITS, Budget>;
    cache: Map<string, { until: number; promise: Promise<any> }>;
  };
};
const state = (globals.basqitFundingProvider ??= {
  budgets: { quotes: { start: 0, count: 0, active: 0 }, status: { start: 0, count: 0, active: 0 } },
  cache: new Map(),
});
export async function fundingRequest(path: "quotes" | "status", params: URLSearchParams) {
  if (process.env.BASQIT_ENABLE_FUNDING !== "true") throw new ScanError("Cross-chain funding is not enabled.", 503);
  const key = process.env.ZEROX_API_KEY?.trim();
  if (!key) throw new ScanError("Funding is not configured.", 503);
  const id = `${path}:${params}`,
    now = Date.now();
  const cached = state.cache.get(id);
  if (cached && cached.until > now) return cached.promise;
  for (const [k, v] of state.cache) if (v.until <= now) state.cache.delete(k);
  const budget = state.budgets[path];
  if (now - budget.start >= 60000) {
    budget.start = now;
    budget.count = 0;
  }
  if (budget.count >= LIMITS[path].perMinute || budget.active >= LIMITS[path].active || state.cache.size >= 256) {
    console.warn(`[budget] funding ${path} provider budget used up`);
    throw new ScanError("Funding request limit reached. Try again shortly.", 429);
  }
  budget.count++;
  budget.active++;
  const entry = { until: Infinity, promise: Promise.resolve() as Promise<any> };
  entry.promise = (async () => {
    try {
      const response = await fetch(`https://api.0x.org/cross-chain/${path}?${params}`, {
        headers: { "0x-api-key": key, "0x-version": "v2" },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new ScanError(
          response.status === 429
            ? "Quote provider is busy. Try again shortly."
            : "No funding route available for this request. Try another asset or amount.",
          response.status === 429 ? 429 : 502,
        );
      const data = await response.json();
      return { ...data, _basqitExpiresAt: now + 30000 };
    } catch (error) {
      throw error instanceof ScanError ? error : new ScanError("Funding provider is temporarily unavailable.", 503);
    } finally {
      budget.active--;
      entry.until = Date.now() + 5000;
    }
  })();
  state.cache.set(id, entry);
  return entry.promise;
}
export async function getFundingQuote(params: URLSearchParams): Promise<FundingQuote> {
  const p = parseFundingInput(params);
  const fee = swapFeeConfig(process.env.BASQIT_SWAP_FEE_BPS, process.env.BASQIT_SWAP_FEE_RECIPIENT);
  const data = await fundingRequest(
    "quotes",
    new URLSearchParams({
      originChain: String(p.chainId),
      destinationChain: "4663",
      sellToken: p.token,
      buyToken: fundingDestinations[p.destination].address,
      sellAmount: p.amount,
      originAddress: p.wallet,
      destinationAddress: p.wallet,
      sortQuotesBy: "price",
      maxNumQuotes: "1",
      ...(fee.bps > 0 ? { feeBps: String(fee.bps), feeRecipient: fee.recipient!, feeToken: p.token } : {}),
    }),
  );
  const q = data.quotes?.[0],
    tx = q?.transaction?.details;
  const issues = q?.issues ?? data.issues;
  const spender = issues?.allowance?.spender ?? data.allowanceTarget ?? null;
  if (
    !data.liquidityAvailable ||
    !q ||
    data.originChainId !== p.chainId ||
    data.destinationChainId !== 4663 ||
    data.sellToken?.toLowerCase() !== p.token.toLowerCase() ||
    data.buyToken?.toLowerCase() !== fundingDestinations[p.destination].address.toLowerCase() ||
    q.sellAmount !== p.amount ||
    !/^\d+$/.test(q.buyAmount) ||
    !/^[1-9]\d*$/.test(q.minBuyAmount) ||
    BigInt(q.minBuyAmount) > BigInt(q.buyAmount) ||
    q.transaction?.chainType !== "evm" ||
    !/^0x[0-9a-f]{40}$/i.test(tx?.to) ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(tx?.data) ||
    !/^\d+$/.test(tx?.value) ||
    !/^0x[0-9a-f]{1,128}$/i.test(q.quoteId) ||
    (spender && spender.toLowerCase() !== ALLOWANCE_HOLDER.toLowerCase())
  )
    throw new ScanError("No valid funding quote returned.", 502);
  // Metadata is not execution: bind what the wallet will actually send to the approved intent.
  const nativeInput = p.token.toLowerCase() === NATIVE ? BigInt(p.amount) : 0n;
  const nativeFee = BigInt(tx.value) - nativeInput;
  if (
    nativeFee < 0n ||
    nativeFee > MAX_FUNDING_NATIVE_FEE ||
    [p.token, p.wallet, NATIVE].some(a => a.toLowerCase() === tx.to.toLowerCase()) ||
    BigInt(q.minBuyAmount) * 10000n < BigInt(q.buyAmount) * (10000n - MAX_FUNDING_SLIPPAGE_BPS)
  )
    throw new ScanError("Funding quote does not match the requested transfer.", 502);
  if (issues?.balance || issues?.simulationIncomplete)
    throw new ScanError("Check your source balance; this route could not be fully simulated.", 422);
  const fees = q.fees?.integratorFees ?? (q.fees?.integratorFee ? [q.fees.integratorFee] : []);
  const expectedFee = (BigInt(p.amount) * BigInt(fee.bps)) / 10000n;
  if (!Array.isArray(fees) || fees.length > 1 || (fee.bps > 0 && fees.length !== 1))
    throw new ScanError("Funding quote is missing the configured Basqit fee.", 502);
  const reportedFee = fees[0];
  if (
    reportedFee &&
    (typeof reportedFee.amount !== "string" ||
      !/^\d+$/.test(reportedFee.amount) ||
      BigInt(reportedFee.amount) !== expectedFee ||
      typeof reportedFee.token !== "string" ||
      reportedFee.token.toLowerCase() !== p.token.toLowerCase() ||
      (reportedFee.recipient !== undefined && reportedFee.recipient?.toLowerCase() !== fee.recipient?.toLowerCase()))
  )
    throw new ScanError("Funding quote fee does not match the configured Basqit fee.", 502);
  return {
    destination: p.destination,
    basqitFee: { ...fee, token: p.token, amount: expectedFee.toString() },
    wallet: p.wallet,
    chainId: p.chainId,
    token: p.token,
    sellAmount: p.amount,
    buyAmount: q.buyAmount,
    minBuyAmount: q.minBuyAmount,
    expiresAt: data._basqitExpiresAt,
    quoteId: q.quoteId,
    spender,
    provider: q.steps?.find((s: { type: string }) => s.type === "bridge")?.provider ?? "0x",
    seconds: q.estimatedTimeSeconds,
    fee: q.fees?.zeroExFee ?? null,
    nativeFee: nativeFee.toString(),
    transaction: { to: tx.to, data: tx.data, value: tx.value },
  };
}
