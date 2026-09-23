import { sealData, unsealData } from "iron-session";
import { randomBytes } from "node:crypto";
import { type Hex, type PublicClient } from "viem";
import { parseSiweMessage } from "viem/siwe";

export const SESSION_COOKIE = "basqit-session";
export const CHALLENGE_COOKIE = "basqit-challenge";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
// The challenge lives in a sealed cookie, so sign-in works across server instances without shared storage.
// ponytail: a sealed challenge can be replayed with its own signature for 5 minutes; that only re-issues the signer's session.
const CHALLENGE_SECONDS = 5 * 60;
export async function issueChallenge() {
  const nonce = randomBytes(16).toString("hex");
  const id = await sealData({ nonce }, { password: sessionPassword(), ttl: CHALLENGE_SECONDS });
  return { id, nonce };
}
function sessionPassword() {
  const password = process.env.IRON_SESSION_SECRET;
  if (!password || password.length < 32) throw new Error("IRON_SESSION_SECRET must contain at least 32 characters.");
  return password;
}
type Session = { address: string; expires: number };
export async function getSession(token?: string) {
  if (!token || token.length > 4096) return undefined;
  const session = await unsealData<Partial<Session>>(token, { password: sessionPassword(), ttl: SESSION_SECONDS });
  if (
    typeof session.address !== "string" ||
    !/^0x[0-9a-f]{40}$/.test(session.address) ||
    typeof session.expires !== "number" ||
    session.expires <= Date.now()
  )
    return undefined;
  return session as Session;
}
export async function verifyChallenge(
  id: string,
  message: string,
  signature: Hex,
  origin: string,
  client: PublicClient,
) {
  const challenge =
    id.length <= 4096
      ? await unsealData<{ nonce?: string }>(id, { password: sessionPassword(), ttl: CHALLENGE_SECONDS })
      : {};
  if (typeof challenge.nonce !== "string") throw new Error("Sign-in expired. Please try again.");
  const parsed = parseSiweMessage(message);
  if (
    parsed.uri !== origin ||
    parsed.domain !== new URL(origin).host ||
    parsed.chainId !== client.chain?.id ||
    !parsed.address ||
    !parsed.issuedAt ||
    parsed.issuedAt.getTime() > Date.now() + 30000 ||
    parsed.issuedAt.getTime() < Date.now() - 5 * 60000 ||
    !(await client.verifySiweMessage({ message, signature, nonce: challenge.nonce, domain: new URL(origin).host }))
  )
    throw new Error("Invalid sign-in signature.");
  const session = { address: parsed.address.toLowerCase(), expires: Date.now() + SESSION_SECONDS * 1000 };
  const token = await sealData(session, { password: sessionPassword(), ttl: SESSION_SECONDS });
  return { token, ...session };
}
