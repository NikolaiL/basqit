import { ALLOWANCE_HOLDER, USDG } from "../trading/quote";
import { ScanError } from "./balances";
import { type FundingQuote, parseFundingInput } from "./shared";

// ponytail: development-only process budget; shared durable quotas are required before production.
const globals = globalThis as typeof globalThis & {
  basqitFundingProvider?: {
    start: number;
    count: number;
    active: number;
    cache: Map<string, { until: number; promise: Promise<any> }>;
  };
};
const state = (globals.basqitFundingProvider ??= { start: 0, count: 0, active: 0, cache: new Map() });
export async function fundingRequest(path: "quotes" | "status", params: URLSearchParams) {
  if (process.env.NODE_ENV !== "development" || process.env.BASQIT_ENABLE_FUNDING !== "true")
    throw new ScanError("Cross-chain funding is not enabled.", 503);
  const key = process.env.ZEROX_API_KEY?.trim();
  if (!key) throw new ScanError("Funding is not configured.", 503);
  const id = `${path}:${params}`,
    now = Date.now();
  const cached = state.cache.get(id);
  if (cached && cached.until > now) return cached.promise;
  for (const [k, v] of state.cache) if (v.until <= now) state.cache.delete(k);
  if (now - state.start >= 60000) {
    state.start = now;
    state.count = 0;
  }
  if (state.count >= 60 || state.active >= 4 || state.cache.size >= 256)
    throw new ScanError("Funding request limit reached. Try again shortly.", 429);
  state.count++;
  state.active++;
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
      state.active--;
      entry.until = Date.now() + 5000;
    }
  })();
  state.cache.set(id, entry);
  return entry.promise;
}
export async function getFundingQuote(params: URLSearchParams): Promise<FundingQuote> {
  const p = parseFundingInput(params);
  const data = await fundingRequest(
    "quotes",
    new URLSearchParams({
      originChain: String(p.chainId),
      destinationChain: "4663",
      sellToken: p.token,
      buyToken: USDG,
      sellAmount: p.amount,
      originAddress: p.wallet,
      destinationAddress: p.wallet,
      sortQuotesBy: "price",
      maxNumQuotes: "1",
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
    data.buyToken?.toLowerCase() !== USDG.toLowerCase() ||
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
  if (issues?.balance || issues?.simulationIncomplete)
    throw new ScanError("Check your source balance; this route could not be fully simulated.", 422);
  return {
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
    transaction: { to: tx.to, data: tx.data, value: tx.value },
  };
}
