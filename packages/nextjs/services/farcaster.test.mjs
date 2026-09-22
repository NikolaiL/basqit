import { farcasterManifest, farcasterOrigin, miniappEmbed } from "./farcaster.ts";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_URL = "https://basqit.vercel.app/";
for (const key of ["FARCASTER_HEADER", "FARCASTER_PAYLOAD", "FARCASTER_SIGNATURE"]) delete process.env[key];
const placeholder = { header: "header", payload: "payload", signature: "signature" };
const origin = farcasterOrigin();
assert.equal(origin, "https://basqit.vercel.app");
assert.deepEqual(farcasterManifest().accountAssociation, placeholder);
assert.equal(farcasterManifest().miniapp.homeUrl, `${origin}/discover`);
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
