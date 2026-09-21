import type { ExecutionQuote, TradeQuote } from "./quote";
import { USDG } from "./quote";
import { V3_ROUTER, v3Abi } from "./uniswap";
import { decodeFunctionData, encodeFunctionData } from "viem";

export type BatchResult = { token: string; quote: TradeQuote | null; error: string | null };
export type BatchQuoteResponse = { results: BatchResult[]; quote: BatchQuote | null };

export function mergeQuoteErrors(previous: Record<string, string>, results: BatchResult[]) {
  const next = { ...previous };
  for (const result of results) {
    const key = result.token.toLowerCase();
    if (result.error) next[key] = result.error;
    else if (result.quote) delete next[key];
  }
  return next;
}

export async function quoteEachStock(tokens: string[], quote: (token: string, index: number) => Promise<TradeQuote>) {
  const results: BatchResult[] = [];
  // Bound RPC fan-out; one failed route must not discard the other results.
  for (let i = 0; i < tokens.length; i += 2) {
    results.push(
      ...(await Promise.all(
        tokens.slice(i, i + 2).map(async (token, offset) => {
          try {
            return { token, quote: await quote(token, i + offset), error: null };
          } catch (error) {
            return {
              token,
              quote: null,
              error: error instanceof Error ? error.message : "Quote unavailable. Retry later.",
            };
          }
        }),
      )),
    );
  }
  return results;
}

export type BatchQuote = ExecutionQuote & { legs: TradeQuote[] };

export function splitAmount(total: bigint, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 8 || total < BigInt(count))
    throw new Error("Enter enough USDG for 1–8 stocks.");
  return Array.from({ length: count }, (_, i) => total / BigInt(count) + (BigInt(i) < total % BigInt(count) ? 1n : 0n));
}

export function combineBuys(legs: TradeQuote[]): BatchQuote {
  if (!legs.length || legs.length > 8) throw new Error("Select 1–8 stocks.");
  const first = legs[0];
  const tokens = new Set<string>();
  let total = 0n;
  let deadline: bigint | undefined;
  const calls: `0x${string}`[] = [];
  for (const leg of legs) {
    if (
      leg.provider !== "uniswap" ||
      leg.spender.toLowerCase() !== V3_ROUTER ||
      leg.transaction.to.toLowerCase() !== V3_ROUTER ||
      leg.transaction.value !== "0" ||
      leg.sellToken.toLowerCase() !== USDG.toLowerCase() ||
      leg.taker.toLowerCase() !== first.taker.toLowerCase() ||
      leg.sellDecimals !== first.sellDecimals ||
      BigInt(leg.sellAmount) <= 0n ||
      leg.expiresAt <= Date.now() ||
      tokens.has(leg.buyToken.toLowerCase())
    )
      throw new Error("Invalid batch quote.");
    tokens.add(leg.buyToken.toLowerCase());
    const decoded = decodeFunctionData({ abi: v3Abi, data: leg.transaction.data });
    if (decoded.functionName !== "multicall") throw new Error("Invalid batch calldata.");
    const [expires, inner] = decoded.args;
    deadline = deadline === undefined || expires < deadline ? expires : deadline;
    calls.push(...inner);
    total += BigInt(leg.sellAmount);
  }
  if (legs.some(leg => BigInt(leg.balance) < total)) throw new Error("Insufficient USDG for all stocks.");
  return {
    provider: "uniswap",
    spender: V3_ROUTER,
    sellToken: USDG,
    sellAmount: String(total),
    taker: first.taker,
    expiresAt: Math.min(...legs.map(leg => leg.expiresAt)),
    legs,
    transaction: {
      to: V3_ROUTER,
      value: "0",
      data: encodeFunctionData({ abi: v3Abi, functionName: "multicall", args: [deadline!, calls] }),
    },
  };
}
