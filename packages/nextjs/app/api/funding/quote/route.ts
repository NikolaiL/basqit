import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSession } from "~~/services/auth/session";
import { ScanError } from "~~/services/funding/balances";
import { getFundingQuote } from "~~/services/funding/provider";
import { clientKey, takeAllowance } from "~~/services/rate-limit";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new ScanError("Cross-site requests are not allowed.", 403);
    // Paid quotes are for the signed-in wallet only, a few per minute each (as balances and stock quotes).
    const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
    if (!session) throw new ScanError("Sign in with your wallet to get a funding quote.", 401);
    if (request.nextUrl.searchParams.get("wallet")?.toLowerCase() !== session.address)
      throw new ScanError("Funding quotes are only for the signed-in wallet.", 403);
    if (!takeAllowance(`funding-quote:${clientKey(request.headers, session.address)}`, 10))
      throw new ScanError("Too many funding quotes. Try again in a minute.", 429);
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
