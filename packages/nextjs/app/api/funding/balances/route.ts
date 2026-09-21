import { NextRequest, NextResponse } from "next/server";
import { ScanError, readFundingBalances } from "~~/services/funding/balances";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 ? { "Retry-After": "3600" } : {}),
      },
    });
  // Secondary browser protection only; the global upstream budget does not trust IP/Origin headers.
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return reply({ error: "Cross-site requests are not allowed." }, 403);
  const params = request.nextUrl.searchParams;
  if (
    [...params.keys()].some(key => !["address", "pageKey"].includes(key)) ||
    params.getAll("address").length !== 1 ||
    params.getAll("pageKey").length > 1
  )
    return reply({ error: "Supply one wallet address only." }, 400);
  try {
    return reply(await readFundingBalances(params.get("address") ?? "", params.get("pageKey") ?? ""));
  } catch (error) {
    return reply(
      { error: error instanceof ScanError ? error.message : "Wallet scan unavailable." },
      error instanceof ScanError ? error.status : 503,
    );
  }
}
