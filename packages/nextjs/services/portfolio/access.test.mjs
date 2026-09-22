import { SESSION_COOKIE, deleteSession, issueChallenge, verifyChallenge } from "../auth/session.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier === "~~/services/auth/session")
      return { url: new URL("../auth/session.ts", import.meta.url).href, shortCircuit: true };
    if (specifier === "~~/services/portfolio/server")
      return {
        url:
          "data:text/javascript," +
          encodeURIComponent(
            "export async function getPortfolio(address) { globalThis.portfolioCalls++; return { address, holdings: [] }; }",
          ),
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { NextRequest } = await import("next/server");
const { GET } = await import("../../app/api/stocks/portfolio/route.ts");
globalThis.portfolioCalls = 0;
const watched = "0x0000000000000000000000000000000000000001";
const request = token =>
  new NextRequest(`https://basqit.example/api/stocks/portfolio?address=${watched}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
assert.equal((await GET(request())).status, 401);
assert.equal((await GET(request("forged"))).status, 401);
assert.equal(globalThis.portfolioCalls, 0);
const account = privateKeyToAccount(generatePrivateKey());
const challenge = issueChallenge();
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
  transport: custom(
    {
      request: async () => {
        throw new Error("No RPC in tests");
      },
    },
    { retryCount: 0 },
  ),
});
const session = await verifyChallenge(
  challenge.id,
  message,
  await account.signMessage({ message }),
  "https://basqit.example",
  client,
);
try {
  const response = await GET(request(session.token));
  assert.equal(response.status, 200, "signed-in viewer can watch another wallet");
  assert.equal((await response.json()).address, watched);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(globalThis.portfolioCalls, 1);
} finally {
  deleteSession(session.token);
}
assert.equal((await GET(request(session.token))).status, 401);
assert.equal(globalThis.portfolioCalls, 1);
console.log("Portfolio access: unsigned/forged/revoked sessions rejected; signed viewer can read another wallet.");
