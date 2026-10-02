import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, requestOrigin } from "~~/services/auth/session";
import { saveSocial } from "~~/services/profiles/db";
import { farcasterName, fidFromToken, finishFarcasterSignIn, startFarcasterSignIn } from "~~/services/profiles/social";
import { takeAllowance } from "~~/services/rate-limit";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Links a Farcaster account to the signed-in wallet. In the mini app the client sends a Quick Auth token; on the web
 * it starts a Sign In with Farcaster request ("start"), then polls it ("poll") until the user approves in Farcaster.
 */
export async function POST(request: NextRequest) {
  let origin: string;
  try {
    origin = requestOrigin(request);
  } catch {
    return reply({ error: "Invalid request origin." }, 403);
  }
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  if (!session) return reply({ error: "Sign in with your wallet first." }, 401);
  if (!takeAllowance(`farcaster-link:${session.address}`, 60)) return reply({ error: "Too many requests." }, 429);
  try {
    const body = await request.json();
    let fid: number | undefined;
    if (body.action === "start") return reply(await startFarcasterSignIn(origin, session.address));
    if (body.action === "quickauth" && typeof body.token === "string" && body.token.length < 4096)
      fid = await fidFromToken(body.token, new URL(origin).host);
    else if (body.action === "poll" && typeof body.channelToken === "string" && body.channelToken.length < 512) {
      fid = await finishFarcasterSignIn(body.channelToken, origin, session.address);
      if (fid === undefined) return reply({ pending: true });
    } else return reply({ error: "Invalid request." }, 400);
    if (!Number.isSafeInteger(fid) || fid! <= 0) throw new Error("Farcaster returned no account.");
    const social = { platform: "farcaster" as const, accountId: String(fid), username: await farcasterName(fid!) };
    await saveSocial(session.address, social);
    return reply({ social });
  } catch (error) {
    console.warn("[farcaster-link]", error instanceof Error ? error.message : error);
    return reply({ error: "Could not verify your Farcaster account. Please try again." }, 400);
  }
}
