import { NextRequest, NextResponse } from "next/server";
import { ScanError } from "~~/services/funding/balances";
import { fundingRequest } from "~~/services/funding/provider";
import { fundingChains } from "~~/services/funding/shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new ScanError("Cross-site requests are not allowed.", 403);
    const p = request.nextUrl.searchParams;
    if (
      [...p.keys()].some(k => !["originChain", "originTxHash", "quoteId"].includes(k)) ||
      [...p.keys()].some(k => p.getAll(k).length !== 1) ||
      !fundingChains.some(c => c.id === Number(p.get("originChain"))) ||
      !/^0x[0-9a-f]{64}$/i.test(p.get("originTxHash") ?? "") ||
      !/^0x[0-9a-f]{1,128}$/i.test(p.get("quoteId") ?? "")
    )
      throw new ScanError("Invalid transfer reference.", 400);
    const result = await fundingRequest("status", p);
    // No recovery calldata is executed by the client. Only display progress and provider recovery information.
    return NextResponse.json(
      {
        status: result.status,
        zid: result.zid,
        failure: result.failure
          ? {
              status: result.failure.status,
              reason: result.failure.reason,
              recovery: result.failure.recovery
                ? {
                    chainId: result.failure.recovery.chainId,
                    token: result.failure.recovery.token,
                    settledAmount: result.failure.recovery.settledAmount,
                    amount: result.failure.recovery.amount,
                  }
                : undefined,
            }
          : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof ScanError ? e.message : "Status unavailable." },
      { status: e instanceof ScanError ? e.status : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
