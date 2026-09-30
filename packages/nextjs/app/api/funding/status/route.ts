import { NextRequest, NextResponse } from "next/server";
import { ScanError } from "~~/services/funding/balances";
import { fundingRequest } from "~~/services/funding/provider";
import { fundingChains } from "~~/services/funding/shared";
import { clientKey, takeAllowance } from "~~/services/rate-limit";

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
    // No sign-in required: recovery must work after a session expires. Status has its own provider capacity.
    const who = clientKey(request.headers);
    // Half the provider's status budget per client, enough to poll one transfer every 10 s; no one caller can take all.
    if (who && !takeAllowance(`funding-status:${who}`, 10))
      throw new ScanError("Too many status checks. Try again in a minute.", 429);
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
