import { LIFI_DIAMOND } from "./lifi";
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

/** One wallet transaction: all direct Uniswap legs in one multicall, or a single LiFi leg. */
export type BatchStep = ExecutionQuote & { legs: TradeQuote[] };
/** USDG approval for one spender, covering every leg that spender executes. */
export type BatchApproval = ExecutionQuote & { allowance: string };
export type BatchQuote = Pick<ExecutionQuote, "sellToken" | "sellAmount" | "taker" | "expiresAt"> & {
  legs: TradeQuote[];
  steps: BatchStep[];
  approvals: BatchApproval[];
};

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
  const direct: TradeQuote[] = [];
  const lifi: TradeQuote[] = [];
  for (const leg of legs) {
    const spender = leg.provider === "uniswap" ? V3_ROUTER : leg.provider === "lifi" ? LIFI_DIAMOND : undefined;
    if (
      !spender ||
      leg.spender.toLowerCase() !== spender.toLowerCase() ||
      leg.transaction.to.toLowerCase() !== spender.toLowerCase() ||
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
    total += BigInt(leg.sellAmount);
    if (leg.provider === "lifi") {
      lifi.push(leg);
      continue;
    }
    direct.push(leg);
    const decoded = decodeFunctionData({ abi: v3Abi, data: leg.transaction.data });
    if (decoded.functionName !== "multicall") throw new Error("Invalid batch calldata.");
    const [expires, inner] = decoded.args;
    deadline = deadline === undefined || expires < deadline ? expires : deadline;
    calls.push(...inner);
  }
  if (legs.some(leg => BigInt(leg.balance) < total)) throw new Error("Insufficient USDG for all stocks.");
  const sum = (group: TradeQuote[]) => group.reduce((acc, leg) => acc + BigInt(leg.sellAmount), 0n);
  const step = (group: TradeQuote[], transaction: TradeQuote["transaction"]): BatchStep => ({
    provider: group[0].provider,
    spender: group[0].spender,
    sellToken: USDG,
    sellAmount: String(sum(group)),
    taker: first.taker,
    expiresAt: Math.min(...group.map(leg => leg.expiresAt)),
    transaction,
    legs: group,
  });
  const steps = [
    ...(direct.length
      ? [
          step(direct, {
            to: V3_ROUTER,
            value: "0",
            data: encodeFunctionData({ abi: v3Abi, functionName: "multicall", args: [deadline!, calls] }),
          }),
        ]
      : []),
    ...lifi.map(leg => step([leg], leg.transaction)),
  ];
  const approvals = [direct, lifi]
    .filter(group => group.length)
    .map(group => ({
      ...step(group, { to: group[0].spender, value: "0", data: "0x" as const }),
      allowance: group[0].allowance,
    }));
  return {
    sellToken: USDG,
    sellAmount: String(total),
    taker: first.taker,
    expiresAt: Math.min(...legs.map(leg => leg.expiresAt)),
    legs,
    steps,
    approvals,
  };
}
