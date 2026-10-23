import { farcasterManifest, farcasterOrigin, miniappEmbed } from "./farcaster.ts";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_URL = "https://basqit.vercel.app/";
for (const key of ["FARCASTER_HEADER", "FARCASTER_PAYLOAD", "FARCASTER_SIGNATURE"]) delete process.env[key];
delete process.env.NEYNAR_NOTIFICATION_URL;
const placeholder = { header: "header", payload: "payload", signature: "signature" };
const origin = farcasterOrigin();
assert.equal(origin, "https://basqit.vercel.app");
assert.deepEqual(farcasterManifest().accountAssociation, placeholder);
assert.equal(farcasterManifest().miniapp.homeUrl, `${origin}/discover`);
assert.equal(farcasterManifest().miniapp.webhookUrl, undefined);
process.env.NEYNAR_NOTIFICATION_URL = "https://api.neynar.com/f/app/test-client/event";
assert.equal(farcasterManifest().miniapp.webhookUrl, process.env.NEYNAR_NOTIFICATION_URL);
for (const invalid of [
  "http://api.neynar.com/f/app/test/event",
  "https://example.com/event",
  "https://api.neynar.com/f/app/test/event?key=secret",
]) {
  process.env.NEYNAR_NOTIFICATION_URL = invalid;
  assert.throws(() => farcasterManifest(), /NEYNAR_NOTIFICATION_URL/);
}
delete process.env.NEYNAR_NOTIFICATION_URL;
process.env.FARCASTER_HEADER = "test-header";
process.env.FARCASTER_SIGNATURE = "test-signature";
process.env.FARCASTER_PAYLOAD = Buffer.from(JSON.stringify({ domain: "wrong.example" })).toString("base64url");
assert.deepEqual(farcasterManifest().accountAssociation, placeholder);
process.env.FARCASTER_PAYLOAD = Buffer.from(JSON.stringify({ domain: "basqit.vercel.app" })).toString("base64url");
assert.equal(farcasterManifest().accountAssociation.signature, "test-signature");
process.env.FARCASTER_PAYLOAD = "malformed";
assert.deepEqual(farcasterManifest().accountAssociation, placeholder);
const query = new URLSearchParams({ theme: "🚀".repeat(180), stocks: "NVDA,SMH", layout: "3" });
const embed = JSON.parse(miniappEmbed(origin, `/discover/og/farcaster?${query}`));
assert.ok(embed.imageUrl.length <= 1024);
assert.equal(new URL(embed.imageUrl).searchParams.get("stocks"), "NVDA,SMH");
assert.equal(new URL(embed.imageUrl).searchParams.get("layout"), "3");
assert.equal(embed.button.action.url, undefined); // Shared query preserved by Farcaster.
assert.equal(embed.button.action.type, "launch_miniapp");
assert.equal(JSON.parse(miniappEmbed(origin, undefined, "/discover")).button.action.url, `${origin}/discover`);
console.log("Farcaster embeds, URL limits and domain association checks passed.");
