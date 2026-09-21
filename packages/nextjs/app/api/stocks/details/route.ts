import { NextRequest, NextResponse } from "next/server";
import { readQuoteDetails } from "~~/services/portfolio/quote-details";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    return NextResponse.json(await readQuoteDetails(symbol), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Market details are temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "15" } },
    );
  }
}
