import { NextRequest, NextResponse } from "next/server";
import { ScanError } from "~~/services/funding/balances";
import { getFundingQuote } from "~~/services/funding/provider";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new ScanError("Cross-site requests are not allowed.", 403);
    return NextResponse.json(await getFundingQuote(request.nextUrl.searchParams), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Funding unavailable." },
      { status: e instanceof ScanError ? e.status : 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
