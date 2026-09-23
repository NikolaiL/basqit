import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSession } from "~~/services/auth/session";
import { ScanError, readFundingBalances } from "~~/services/funding/balances";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return reply({ error: "Sign in with your wallet to load balances." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return reply({ error: "Cross-site requests are not allowed." }, 403);
  const params = request.nextUrl.searchParams;
  if (
    [...params.keys()].some(key => !["address", "pageKey"].includes(key)) ||
    params.getAll("address").length !== 1 ||
    params.getAll("pageKey").length > 1
  )
    return reply({ error: "Supply one wallet address only." }, 400);
  if (params.get("address")?.toLowerCase() !== session.address)
    return reply({ error: "You can only load your signed-in wallet." }, 403);
  try {
    return reply(await readFundingBalances(params.get("address") ?? "", params.get("pageKey") ?? ""));
  } catch (error) {
    return reply(
      { error: error instanceof ScanError ? error.message : "Wallet scan unavailable." },
      error instanceof ScanError ? error.status : 503,
    );
  }
}
