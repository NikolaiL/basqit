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
const { shareSelection } = await import("./share.ts");
assert.deepEqual(shareSelection(" AI\nCompanies ", "nvda,NVDA,../../secret,MSFT,constructor"), {
  theme: "AI Companies",
  symbols: ["NVDA", "MSFT"],
});
assert.deepEqual(shareSelection([], []), { theme: "", symbols: [] });
assert.equal(shareSelection("x".repeat(200), "").theme.length, 180);
assert.equal(shareSelection("AI", "NVDA,MSFT,GOOGL,AMD,AMZN,META,PLTR,AVGO,AAPL").symbols.length, 8);
console.log("Shared selections: bounded theme, known logos, deduplication and eight-stock cap passed.");
