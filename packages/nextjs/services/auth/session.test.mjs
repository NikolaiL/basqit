import { getSession, issueChallenge, verifyChallenge } from "./session.ts";
import assert from "node:assert/strict";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

process.env.IRON_SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
const account = privateKeyToAccount(generatePrivateKey());
const client = createPublicClient({
  chain: mainnet,
  transport: custom(
    {
      request: async () => {
        throw new Error("No RPC in EOA signature tests");
      },
    },
    { retryCount: 0 },
  ),
});
const origin = "https://basqit.example";
const originalNow = Date.now;
async function signed(challenge, overrides = {}) {
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: "basqit.example",
    uri: origin,
    nonce: challenge.nonce,
    version: "1",
    ...overrides,
  });
  return { message, signature: await account.signMessage({ message }) };
}
async function verify(challenge, overrides = {}) {
  const { message, signature } = await signed(challenge, overrides);
  return verifyChallenge(challenge.id, message, signature, origin, client);
}
try {
  assert.equal(await getSession("invented"), undefined);
  const first = issueChallenge();
  const session = await verify(first);
  assert.equal((await getSession(session.token)).address, account.address.toLowerCase());
  assert.equal(await getSession(session.token.slice(0, -8) + "tampered"), undefined);
  const { spawnSync } = await import("node:child_process");
  const fresh = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { getSession } from './services/auth/session.ts';
    let token = ''; for await (const chunk of process.stdin) token += chunk;
    console.log(JSON.stringify(await getSession(token)));
  `,
    ],
    { input: session.token, encoding: "utf8", env: process.env },
  );
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(
    JSON.parse(fresh.stdout).address,
    account.address.toLowerCase(),
    "session survives a fresh server process",
  );
  await assert.rejects(verify(first), /expired/, "one-time challenge");
  for (const overrides of [
    { domain: "evil.example" },
    { uri: "https://evil.example" },
    { chainId: 10 },
    { nonce: "differentNonce" },
    { issuedAt: new Date(Date.now() - 600000) },
    { expirationTime: new Date(Date.now() - 1000) },
  ]) {
    await assert.rejects(verify(issueChallenge(), overrides), /Invalid/);
  }
  const wrong = issueChallenge();
  const { message } = await signed(wrong);
  const other = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(verifyChallenge(wrong.id, message, await other.signMessage({ message }), origin, client));
  const replaced = issueChallenge();
  issueChallenge(replaced.id);
  await assert.rejects(verify(replaced), /expired/);
  const expiring = await verify(issueChallenge());
  const expiredChallenge = issueChallenge();
  Date.now = () => originalNow() + 31 * 24 * 3600000;
  assert.equal(await getSession(expiring.token), undefined);
  await assert.rejects(verify(expiredChallenge), /expired/);
  console.log("SIWE: signature, domain, URI, chain, nonce replay and expiration checks passed");
} finally {
  Date.now = originalNow;
}
