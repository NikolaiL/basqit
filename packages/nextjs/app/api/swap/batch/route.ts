import { NextRequest, NextResponse } from "next/server";
import { GET as quoteStock } from "../route";
import { formatUnits, isAddress, parseUnits } from "viem";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { atlasClient } from "~~/services/atlas/client";
import { SESSION_COOKIE, getSession } from "~~/services/auth/session";
import { combineBuys, quoteEachStock, splitAmount } from "~~/services/trading/batch";
import { type TradeQuote, USDG } from "~~/services/trading/quote";

export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.BASQIT_ENABLE_TRADING !== "true") return reply({ error: "Trading is not enabled yet." }, 503);
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  if (!session) return reply({ error: "Sign in with your wallet to get a quote." }, 401);
  const params = request.nextUrl.searchParams;
  const tokens = (params.get("tokens") ?? "").split(",");
  const taker = params.get("taker") ?? "";
  const amount = params.get("amount") ?? "";
  if (
    tokens.length < 1 ||
    tokens.length > 8 ||
    tokens.some(token => !isAddress(token)) ||
    new Set(tokens.map(token => token.toLowerCase())).size !== tokens.length ||
    !isAddress(taker) ||
    !/^\d{1,40}(\.\d{1,36})?$/.test(amount)
  )
    return reply({ error: "Enter a valid amount, wallet and 1–8 distinct stocks." }, 400);
  try {
    const decimals = await atlasClient.readContract({ address: USDG, abi: tradeTokenAbi, functionName: "decimals" });
    if ((amount.split(".")[1]?.length ?? 0) > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
    const allocations = splitAmount(parseUnits(amount, decimals), tokens.length);
    const results = await quoteEachStock(tokens, async (token, index) => {
      const url = new URL("/api/swap", request.url);
      url.search = new URLSearchParams({
        token,
        taker,
        amount: formatUnits(allocations[index], decimals),
        side: "buy",
        provider: "uniswap-first",
      }).toString();
      const response = await quoteStock(new NextRequest(url, { headers: request.headers }));
      const quote = await response.json();
      if (!response.ok) throw new Error(quote.error ?? "No available route for this stock.");
      return quote as TradeQuote;
    });
    // Partial results are review-only. Excluding failed stocks requests a fresh allocation and quote.
    const quote = results.every(result => result.quote) ? combineBuys(results.map(result => result.quote!)) : null;
    return reply({ results, quote });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Batch quote unavailable." }, 503);
  }
}
