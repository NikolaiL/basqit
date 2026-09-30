import { SESSION_COOKIE, issueChallenge, verifyChallenge } from "./auth/session.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier === "~~/services/funding/provider")
      return {
        url:
          "data:text/javascript," +
          encodeURIComponent("export async function getFundingQuote() { globalThis.quotes++; return { ok: true }; }"),
        shortCircuit: true,
      };
    if (specifier.startsWith("~~/"))
      return { url: new URL(`../${specifier.slice(3)}.ts`, import.meta.url).href, shortCircuit: true };
    const ours = !context.parentURL?.includes("/node_modules/");
    return next(
      ours && specifier.startsWith("./") && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier,
      context,
    );
  },
});
const { takeAllowance, clientKey } = await import("./rate-limit.ts");
console.warn = () => {};

// Allowances are per key and per minute.
assert.equal(takeAllowance("t:a", 2, 0), true);
assert.equal(takeAllowance("t:a", 2, 1), true);
assert.equal(takeAllowance("t:a", 2, 2), false, "a caller's own allowance runs out");
assert.equal(takeAllowance("t:b", 2, 3), true, "without touching anyone else's");
assert.equal(takeAllowance("t:a", 2, 60_001), true, "and refills after the window");

// Forwarding headers count only behind a platform that overwrites them.
const headers = new Headers({ "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "2.2.2.2, 9.9.9.9" });
delete process.env.VERCEL;
delete process.env.BASQIT_TRUST_PROXY;
assert.equal(clientKey(headers), undefined, "spoofable header ignored");
assert.equal(clientKey(headers, "0xABC"), "wallet:0xabc");
process.env.BASQIT_TRUST_PROXY = "true";
assert.equal(clientKey(headers), "ip:1.1.1.1");
process.env.VERCEL = "1";
assert.equal(clientKey(headers), "ip:2.2.2.2", "Vercel's own header wins on Vercel");
delete process.env.VERCEL;
delete process.env.BASQIT_TRUST_PROXY;

// Funding quotes: signed-in wallet only, and only for that wallet.
process.env.IRON_SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
globalThis.quotes = 0;
const { NextRequest } = await import("next/server");
const { GET } = await import("../app/api/funding/quote/route.ts");
const account = privateKeyToAccount(generatePrivateKey());
const challenge = await issueChallenge();
const message = createSiweMessage({
  address: account.address,
  chainId: 1,
  domain: "basqit.example",
  uri: "https://basqit.example",
  nonce: challenge.nonce,
  version: "1",
});
const client = createPublicClient({
  chain: mainnet,
  transport: custom({ request: async () => Promise.reject(new Error("No RPC in tests")) }, { retryCount: 0 }),
});
const { token } = await verifyChallenge(
  challenge.id,
  message,
  await account.signMessage({ message }),
  "https://basqit.example",
  client,
);
const quote = (wallet, cookie) =>
  GET(
    new NextRequest(`https://basqit.example/api/funding/quote?wallet=${wallet}`, {
      headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
    }),
  );
const other = "0x0000000000000000000000000000000000000001";
assert.equal((await quote(account.address)).status, 401, "no session, no paid quote");
assert.equal((await quote(other, token)).status, 403, "another wallet's quote");
for (let i = 0; i < 10; i++) assert.equal((await quote(account.address, token)).status, 200);
assert.equal((await quote(account.address, token)).status, 429, "per-wallet allowance");
assert.equal(globalThis.quotes, 10);
console.log("Rate limits: per-caller allowances, trusted client keys, session-bound funding quotes passed.");
