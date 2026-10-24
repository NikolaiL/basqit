import { fetchDrandProof } from "./drand.ts";
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
