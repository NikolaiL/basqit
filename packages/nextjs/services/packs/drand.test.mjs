import { drandWaitSeconds, fetchDrandProof, fetchLatestDrandRound } from "./drand.ts";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const signature = "ab".repeat(64);
const replies = [
  new Response("Requested future beacon", { status: 425 }),
  new Response("Not found", { status: 404 }),
  Response.json({ round: 123, signature }),
];
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.drand.sh/v2/beacons/evmnet/rounds/123");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return replies.shift();
  };
  // Waiting is not an error; subsequent polls still retrieve the same committed round.
  assert.equal(await fetchDrandProof(123n), null);
  assert.equal(await fetchDrandProof(123n), null);
  assert.equal(await fetchDrandProof(123n), `0x${signature}`);

  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  await assert.rejects(fetchDrandProof(123n), /temporarily unavailable/);
  globalThis.fetch = async () => Response.json({ round: 124, signature });
  await assert.rejects(fetchDrandProof(123n), /Invalid drand response/);
  globalThis.fetch = async () => Response.json({ round: 123, signature: "bad" });
  await assert.rejects(fetchDrandProof(123n), /Invalid drand response/);
} finally {
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.drand.sh/v2/beacons/evmnet/rounds/latest");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return Response.json({ round: 123 });
  };
  assert.equal(await fetchLatestDrandRound(), 123n);
  for (const round of [0, -1, 1.5, "123", Number.MAX_SAFE_INTEGER + 1]) {
    globalThis.fetch = async () => Response.json({ round });
    await assert.rejects(fetchLatestDrandRound(), /Invalid drand round/);
  }
  globalThis.fetch = async url =>
    url.endsWith("/latest") ? new Response("Unavailable", { status: 503 }) : Response.json({ round: 123, signature });
  await assert.rejects(fetchLatestDrandRound(), /temporarily unavailable/);
  assert.equal(await fetchDrandProof(123n), `0x${signature}`);
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(drandWaitSeconds(123n, 133n), 30n);
assert.equal(drandWaitSeconds(132n, 133n), 3n);
assert.equal(drandWaitSeconds(133n, 133n), 0n);
assert.equal(drandWaitSeconds(134n, 133n), 0n);
