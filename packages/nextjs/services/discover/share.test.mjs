import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, next) {
    if (url.endsWith("/logos.json"))
      return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true };
    return next(url, context);
  },
});
const { shareSelection, shareOrigin, shareLayout, discoveryPath } = await import("./share.ts");
const resultUrl = new URL(discoveryPath("AI & chips", ["SMH", "NVDA"], "AMD"), "https://basqit.vercel.app");
assert.equal(resultUrl.searchParams.get("theme"), "AI & chips");
assert.equal(resultUrl.searchParams.get("stocks"), "SMH,NVDA");
assert.equal(resultUrl.searchParams.get("similar"), "AMD");
assert.equal(new URL(discoveryPath("no matches", []), resultUrl).searchParams.has("stocks"), false);
assert.equal(discoveryPath("", []), "/discover");
for (let i = 0; i < 4; i++) assert.equal(shareLayout(String(i), "AI"), i);
for (const input of [null, "../secret", "4", "-1", {}]) {
  assert.equal(shareLayout(input, "SMH"), shareLayout(undefined, "SMH"));
  assert.ok(shareLayout(input, "SMH") >= 0 && shareLayout(input, "SMH") < 4);
}
assert.deepEqual(shareSelection(" AI\nCompanies ", "nvda,NVDA,../../secret,MSFT,constructor"), {
  theme: "AI Companies",
  symbols: ["NVDA", "MSFT"],
});
assert.deepEqual(shareSelection([], []), { theme: "", symbols: [] });
assert.equal(shareSelection("x".repeat(200), "").theme.length, 180);
assert.equal(shareSelection("AI", "NVDA,MSFT,GOOGL,AMD,AMZN,META,PLTR,AVGO,AAPL").symbols.length, 8);
console.log("Shared selections: bounded theme, known logos, deduplication and eight-stock cap passed.");

assert.equal(shareOrigin("basqit.ngrok.dev"), "https://basqit.ngrok.dev");
assert.equal(shareOrigin("localhost:3000"), "https://basqit.vercel.app");
assert.equal(shareOrigin("attacker.test", "basqit.vercel.app"), "https://basqit.vercel.app");
