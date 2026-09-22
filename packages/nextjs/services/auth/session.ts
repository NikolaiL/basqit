import { randomBytes } from "node:crypto";
import { type Hex, type PublicClient } from "viem";
import { parseSiweMessage } from "viem/siwe";

export const SESSION_COOKIE = "basqit-session";
export const CHALLENGE_COOKIE = "basqit-challenge";
export const SESSION_SECONDS = 24 * 60 * 60;
// ponytail: single-process preview sessions; use shared storage before a multi-instance deployment.
const globals = globalThis as typeof globalThis & {
  basqitAuth?: {
    challenges: Map<string, { nonce: string; expires: number }>;
    sessions: Map<string, { address: string; expires: number }>;
  };
};
const state = (globals.basqitAuth ??= { challenges: new Map(), sessions: new Map() });
function prune() {
  for (const map of [state.challenges, state.sessions])
    for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
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
export function getSession(id?: string) {
  prune();
  return id ? state.sessions.get(id) : undefined;
}
export function deleteSession(id?: string) {
  if (id) state.sessions.delete(id);
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
  if (state.sessions.size >= 10000) throw new Error("Sign-in temporarily unavailable.");
  const token = randomBytes(32).toString("hex");
  const session = { address: parsed.address.toLowerCase(), expires: Date.now() + SESSION_SECONDS * 1000 };
  state.sessions.set(token, session);
  return { token, ...session };
}
