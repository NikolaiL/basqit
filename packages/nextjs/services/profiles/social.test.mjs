import { farcasterName, finishFarcasterSignIn, pkce, xAuthorizeUrl } from "./social.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createSiweMessage } from "viem/siwe";

const realFetch = globalThis.fetch;
const respond = body => async () => new Response(JSON.stringify(body), { status: 200 });

test("pkce challenge is the S256 of the verifier and the authorize URL carries it", () => {
  const { verifier, challenge, state } = pkce();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.ok(verifier.length >= 43 && state.length === 32);
  const url = new URL(xAuthorizeUrl("client", "https://basqit.example/api/social/x/callback", state, challenge));
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "users.read tweet.read");
  assert.equal(url.searchParams.get("state"), state);
});

test("a Farcaster approval is refused when it names another wallet", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const message = createSiweMessage({
    address: "0x2222222222222222222222222222222222222222",
    chainId: 10,
    domain: "basqit.example",
    uri: "https://basqit.example",
    nonce: "abcdefgh12",
    version: "1",
    requestId: "0x3333333333333333333333333333333333333333",
  });
  try {
    globalThis.fetch = respond({ state: "pending" });
    assert.equal(await finishFarcasterSignIn("token", "https://basqit.example", wallet), undefined);
    globalThis.fetch = respond({ state: "completed", message, signature: "0x00" });
    await assert.rejects(finishFarcasterSignIn("token", "https://basqit.example", wallet), /another wallet/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("farcasterName reads the current fname and ignores a name moved to another FID", async () => {
  try {
    globalThis.fetch = respond({ transfer: { to: 3, username: "dwr" } });
    assert.equal(await farcasterName(3), "dwr");
    globalThis.fetch = respond({ transfer: { to: 4, username: "dwr" } });
    assert.equal(await farcasterName(3), "");
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(await farcasterName(3), "");
  } finally {
    globalThis.fetch = realFetch;
  }
});
