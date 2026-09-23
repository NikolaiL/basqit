import { NextRequest, NextResponse } from "next/server";
import { type Hex, type PublicClient, createPublicClient, http } from "viem";
import { parseSiweMessage } from "viem/siwe";
import scaffoldConfig from "~~/scaffold.config";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  SESSION_SECONDS,
  getSession,
  issueChallenge,
  verifyChallenge,
} from "~~/services/auth/session";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function origin(request: NextRequest) {
  const host = request.headers.get("host");
  const value = request.headers.get("origin");
  if (!host || !value || new URL(value).host !== host || request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Invalid request origin.");
  return value;
}
function cookieOptions(requestOrigin: string, maxAge: number) {
  const secure = requestOrigin.startsWith("https:");
  // Farcaster embeds the app cross-site; partition cookies by the embedding site.
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("strict" as const),
    partitioned: secure,
    path: "/",
    maxAge,
  };
}
export async function GET(request: NextRequest) {
  return reply((await getSession(request.cookies.get(SESSION_COOKIE)?.value)) ?? { address: null });
}
export async function POST(request: NextRequest) {
  try {
    const requestOrigin = origin(request);
    const raw = await request.text();
    if (raw.length > 16000) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "nonce") {
      const challenge = issueChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value);
      const response = reply({ nonce: challenge.nonce });
      response.cookies.set(CHALLENGE_COOKIE, challenge.id, cookieOptions(requestOrigin, 300));
      return response;
    }
    if (
      body.action !== "verify" ||
      typeof body.message !== "string" ||
      body.message.length > 4000 ||
      typeof body.signature !== "string" ||
      !/^0x[0-9a-f]+$/i.test(body.signature)
    )
      return reply({ error: "Invalid sign-in request." }, 400);
    const chainId = parseSiweMessage(body.message).chainId;
    const chain = scaffoldConfig.targetNetworks.find(c => c.id === chainId);
    if (!chain) return reply({ error: "Unsupported sign-in network." }, 400);
    if (!request.cookies.get(CHALLENGE_COOKIE)?.value)
      return reply(
        { error: "Sign-in cookie is missing. Reopen the app and try again.", code: "missing_challenge_cookie" },
        401,
      );
    const client = createPublicClient({ chain, transport: http(undefined, { timeout: 10000, retryCount: 0 }) });
    const session = await verifyChallenge(
      request.cookies.get(CHALLENGE_COOKIE)?.value ?? "",
      body.message,
      body.signature as Hex,
      requestOrigin,
      client as PublicClient,
    );
    const response = reply({ address: session.address, expires: session.expires });
    response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(requestOrigin, SESSION_SECONDS));
    response.cookies.set(CHALLENGE_COOKIE, "", cookieOptions(requestOrigin, 0));
    return response;
  } catch {
    return reply({ error: "Sign-in failed or expired. Please try again." }, 401);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const requestOrigin = origin(request);
    const response = reply({ address: null });
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(requestOrigin, 0));
    response.cookies.set(CHALLENGE_COOKIE, "", cookieOptions(requestOrigin, 0));
    return response;
  } catch {
    return reply({ error: "Invalid request origin." }, 403);
  }
}
