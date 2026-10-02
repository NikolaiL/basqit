import { NextRequest, NextResponse } from "next/server";
import { unsealData } from "iron-session";
import { publicOrigin } from "~~/services/auth/session";
import { saveSocial } from "~~/services/profiles/db";
import { X_COOKIE, xAccount } from "~~/services/profiles/social";

export const runtime = "nodejs";

/** X redirects here after the user approves. Links the X account to the wallet that started the sign-in. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = publicOrigin(request);
  let address: string | undefined;
  let result = "x-failed";
  try {
    const sealed = request.cookies.get(X_COOKIE)?.value;
    const saved = sealed
      ? await unsealData<{ address?: string; state?: string; verifier?: string }>(sealed, {
          password: process.env.IRON_SESSION_SECRET!,
          ttl: 600,
        })
      : {};
    address = saved.address;
    if (address && saved.verifier && saved.state && params.get("state") === saved.state && params.get("code")) {
      const account = await xAccount(params.get("code")!, saved.verifier, `${origin}/api/social/x/callback`);
      await saveSocial(address, { platform: "x", ...account });
      result = "x";
    } else if (params.get("error") === "access_denied") result = "x-cancelled";
  } catch (error) {
    console.warn("[x-link]", error instanceof Error ? error.message : error);
  }
  const back = new URL(address ? `/creators/${address}` : "/", origin);
  back.searchParams.set("linked", result);
  const response = NextResponse.redirect(back);
  response.cookies.set(X_COOKIE, "", { path: "/api/social/x", maxAge: 0 });
  return response;
}
