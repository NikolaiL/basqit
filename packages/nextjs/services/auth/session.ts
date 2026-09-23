import { sealData, unsealData } from "iron-session";
import { randomBytes } from "node:crypto";
import { type Hex, type PublicClient } from "viem";
import { parseSiweMessage } from "viem/siwe";

export const SESSION_COOKIE = "basqit-session";
export const CHALLENGE_COOKIE = "basqit-challenge";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
// ponytail: one-time challenges remain process-local; use shared storage for multi-instance sign-in.
const globals = globalThis as typeof globalThis & {
  basqitAuth?: {
    challenges: Map<string, { nonce: string; expires: number }>;
  };
};
const state = (globals.basqitAuth ??= { challenges: new Map() });
function prune() {
  for (const [key, value] of state.challenges) if (value.expires <= Date.now()) state.challenges.delete(key);
}
export function issueChallenge(previous?: string) {
  prune();
  if (previous) state.challenges.delete(previous);
  if (state.challenges.size >= 10000) throw new Error("Sign-in temporarily unavailable.");
  const id = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  state.challenges.set(id, { nonce, expires: Date.now() + 5 * 60000 });
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
  prune();
  const challenge = state.challenges.get(id);
  state.challenges.delete(id);
  if (!challenge) throw new Error("Sign-in expired. Please try again.");
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
