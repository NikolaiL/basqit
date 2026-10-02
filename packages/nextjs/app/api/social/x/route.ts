import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { SESSION_COOKIE, getSession, publicOrigin } from "~~/services/auth/session";
import { X_COOKIE, pkce, xAuthorizeUrl } from "~~/services/profiles/social";

export const runtime = "nodejs";

/**
 * Starts X sign-in for the signed-in wallet. The wallet, state and PKCE verifier ride in a sealed cookie scoped to
 * this browser, so an authorization started by someone else cannot attach their X account to this wallet or the reverse.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  const origin = publicOrigin(request);
  const back = new URL(session ? `/creators/${session.address}` : "/", origin);
  if (!session) return NextResponse.redirect(back);
  if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET) {
    back.searchParams.set("linked", "x-unavailable");
    return NextResponse.redirect(back);
  }
  const { verifier, challenge, state } = pkce();
  const redirectUri = `${origin}/api/social/x/callback`;
  const response = NextResponse.redirect(xAuthorizeUrl(process.env.X_CLIENT_ID, redirectUri, state, challenge));
  response.cookies.set(
    X_COOKIE,
    await sealData(
      { address: session.address, state, verifier },
      { password: process.env.IRON_SESSION_SECRET!, ttl: 600 },
    ),
    {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      // Lax: the cookie must come back on X's top-level redirect to the callback.
      sameSite: "lax",
      path: "/api/social/x",
      maxAge: 600,
    },
  );
  return response;
}
