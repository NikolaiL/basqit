// Proving that a wallet's owner also controls an X or Farcaster account. Sources, read 2 October 2026:
// Quick Auth https://miniapps.farcaster.xyz/docs/sdk/quick-auth, relay https://docs.farcaster.xyz/auth-kit/client/app/create-channel,
// fnames https://docs.farcaster.xyz/reference/fname/api, X https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token.
import { createClient } from "@farcaster/quick-auth";
import { createHash, randomBytes } from "node:crypto";
import { parseSiweMessage } from "viem/siwe";

export type Platform = "x" | "farcaster";
export type Social = { platform: Platform; accountId: string; username: string };

export const X_COOKIE = "basqit-x-oauth";
const RELAY = "https://relay.farcaster.xyz/v1";
const quickAuth = createClient();
const json = async (response: Response) => {
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
};

/** The FID a Quick Auth token was issued for, for this domain only. */
export async function fidFromToken(token: string, domain: string) {
  return Number((await quickAuth.verifyJwt({ token, domain })).sub);
}

/** The FID's current Farcaster name, from the fname registry; "" when it has none (for example an ENS name). */
export async function farcasterName(fid: number) {
  const { transfer } = await json(
    await fetch(`https://fnames.farcaster.xyz/transfers/current?fid=${fid}`, { signal: AbortSignal.timeout(8000) }),
  ).catch(() => ({ transfer: null }));
  return transfer?.to === fid && typeof transfer.username === "string" ? (transfer.username as string) : "";
}

/**
 * Opens a Sign In with Farcaster request on the relay. The wallet goes in `requestId`, so the message the Farcaster
 * account signs names the wallet it links to. The nonce comes from Quick Auth, which checks it when verifying.
 */
export async function startFarcasterSignIn(origin: string, wallet: string) {
  const { nonce } = await quickAuth.generateNonce();
  const channel = await json(
    await fetch(`${RELAY}/channel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siweUri: origin,
        domain: new URL(origin).host,
        nonce,
        requestId: wallet.toLowerCase(),
        acceptAuthAddress: true,
      }),
      signal: AbortSignal.timeout(8000),
    }),
  );
  return { channelToken: channel.channelToken as string, url: channel.url as string };
}

/** Undefined while the user has not approved; otherwise the FID, verified by Quick Auth and bound to `wallet`. */
export async function finishFarcasterSignIn(channelToken: string, origin: string, wallet: string) {
  const status = await json(
    await fetch(`${RELAY}/channel/status`, {
      headers: { Authorization: `Bearer ${channelToken}` },
      signal: AbortSignal.timeout(8000),
    }),
  );
  if (status.state !== "completed") return undefined;
  const domain = new URL(origin).host;
  const message = String(status.message);
  if (parseSiweMessage(message).requestId !== wallet.toLowerCase())
    throw new Error("This approval is for another wallet.");
  const { token } = await quickAuth.verifySiwf({ message, signature: String(status.signature), domain });
  return fidFromToken(token, domain);
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("hex"),
  };
}

export function xAuthorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "users.read tweet.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

/** Exchanges the authorization code (confidential client) and reads the signed-in X account. */
export async function xAccount(code: string, verifier: string, redirectUri: string) {
  const { access_token } = await json(
    await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(8000),
    }),
  );
  const { data } = await json(
    await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(8000),
    }),
  );
  if (typeof data?.id !== "string" || typeof data?.username !== "string") throw new Error("X returned no account.");
  return { accountId: data.id as string, username: data.username as string };
}
