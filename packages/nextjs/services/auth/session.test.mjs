import { deleteSession, getSession, issueChallenge, verifyChallenge } from "./session.ts";
import assert from "node:assert/strict";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

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
  assert.equal(getSession("invented"), undefined);
  const first = issueChallenge();
  const session = await verify(first);
  assert.equal(getSession(session.token).address, account.address.toLowerCase());
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
  deleteSession(session.token);
  assert.equal(getSession(session.token), undefined);
  const expiring = await verify(issueChallenge());
  const expiredChallenge = issueChallenge();
  Date.now = () => originalNow() + 25 * 3600000;
  assert.equal(getSession(expiring.token), undefined);
  await assert.rejects(verify(expiredChallenge), /expired/);
  console.log("SIWE: signature, domain, URI, chain, nonce replay, logout and expiration checks passed");
} finally {
  Date.now = originalNow;
}
