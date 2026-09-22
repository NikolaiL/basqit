import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier === "~~/services/auth/session")
      return { url: new URL("./session.ts", import.meta.url).href, shortCircuit: true };
    if (specifier === "~~/scaffold.config")
      return {
        url:
          "data:text/javascript," +
          encodeURIComponent(
            'export default {targetNetworks:[{id:1,rpcUrls:{default:{http:["http://127.0.0.1:1"]}}}]}',
          ),
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { NextRequest } = await import("next/server");
const { POST, GET, DELETE } = await import("../../app/api/auth/session/route.ts");
const origin = "https://basqit.example";
const request = (method, body, cookie = "", extra = {}) =>
  new NextRequest(`${origin}/api/auth/session`, {
    method,
    headers: {
      host: "basqit.example",
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie,
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const nonce = await POST(request("POST", { action: "nonce" }));
assert.equal(nonce.status, 200);
const cookie = nonce.headers.get("set-cookie");
for (const attribute of ["HttpOnly", "Secure", "SameSite=none", "Partitioned"])
  assert.ok(cookie.includes(attribute), attribute);
const account = privateKeyToAccount(generatePrivateKey());
const message = createSiweMessage({
  address: account.address,
  chainId: 1,
  domain: "basqit.example",
  uri: origin,
  nonce: (await nonce.json()).nonce,
  version: "1",
});
const body = { action: "verify", message, signature: await account.signMessage({ message }) };
const missing = await POST(request("POST", body));
assert.equal(missing.status, 401);
assert.equal((await missing.json()).code, "missing_challenge_cookie");
const verified = await POST(request("POST", body, cookie.split(";")[0]));
assert.equal(verified.status, 200);
const sessionCookie = verified.cookies.get("basqit-session");
assert.ok(sessionCookie.partitioned);
assert.equal(sessionCookie.sameSite, "none");
const session = `basqit-session=${sessionCookie.value}`;
assert.equal((await (await GET(request("GET", null, session))).json()).address, account.address.toLowerCase());
assert.equal((await POST(request("POST", body, cookie.split(";")[0]))).status, 401, "nonce cannot be replayed");
assert.equal(
  (
    await POST(
      request("POST", { action: "nonce" }, session, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    )
  ).status,
  401,
);
assert.equal((await DELETE(request("DELETE", null, session, { origin: "https://evil.example" }))).status, 403);
const logout = await DELETE(request("DELETE", null, session));
assert.equal(logout.cookies.get("basqit-session").maxAge, 0);
assert.ok(logout.cookies.get("basqit-session").partitioned);
assert.equal((await (await GET(request("GET", null, session))).json()).address, null);
console.log(
  "Auth route: partitioned secure cookies, signed session, replay rejection, origin protection and logout passed.",
);
