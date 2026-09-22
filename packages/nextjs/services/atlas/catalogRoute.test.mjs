import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const asset = { symbol: "AAPL", address: "0x1111111111111111111111111111111111111111" };
let unavailable = false;
let reads = 0;
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../../app/api/stocks/asset/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  {
    exports,
    require: name =>
      name === "next/server"
        ? {
            NextResponse: {
              json: (data, options = {}) => ({ data, status: options.status ?? 200, headers: options.headers }),
            },
          }
        : {
            readCatalog: async () => {
              reads++;
              return { assets: [asset], unavailable };
            },
          },
  },
);
const get = symbol =>
  exports.GET({ nextUrl: new URL(`https://example.test/api/stocks/asset?symbol=${encodeURIComponent(symbol)}`) });
assert.equal((await get("../AAPL")).status, 400);
assert.equal(reads, 0, "invalid input must not load the catalog");
const result = await get("AAPL");
assert.equal(result.status, 200);
assert.equal(result.data, asset);
assert.equal(result.headers["Cache-Control"], "public, max-age=30");
assert.equal((await get("UNKNOWN")).status, 404);
unavailable = true;
assert.equal((await get("AAPL")).status, 503);
console.log("Asset details: input validation, cached result, missing token and unavailable catalog passed.");
