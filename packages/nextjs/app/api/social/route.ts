import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, requestOrigin } from "~~/services/auth/session";
import { deleteSocial } from "~~/services/profiles/db";

export const runtime = "nodejs";

/** Unlinks an X or Farcaster account from the signed-in wallet. */
export async function DELETE(request: NextRequest) {
  try {
    requestOrigin(request);
  } catch {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  if (!session) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  const platform = request.nextUrl.searchParams.get("platform");
  if (platform !== "x" && platform !== "farcaster")
    return NextResponse.json({ error: "Unknown account." }, { status: 400 });
  await deleteSocial(session.address, platform);
  return NextResponse.json({ ok: true });
}
