import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  load(url, context, next) {
    if (url.endsWith("/contracts/deployedContracts.ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    return next(url, context);
  },
  resolve(specifier, context, next) {
    if (specifier === "~~/contracts/deployedContracts")
      return next(new URL("../../contracts/deployedContracts.ts", import.meta.url).href, context);
    return next(specifier, context);
  },
});
const { packsClient, testnetAssets } = await import("./testnet.ts");
const address = n => `0x${n.toString(16).padStart(40, "0")}`;
const [usdg, stock, weth, delisted, pending] = [1, 2, 3, 4, 5].map(address);
let fail = true;
let stockAllowed = true;
packsClient.readContract = async ({ functionName }) => {
  if (functionName === "token") return usdg;
  assert.equal(functionName, "allowedTokens", "use the deployed registry ABI");
  if (fail) throw new Error("RPC unavailable");
  return [usdg, stock, weth, delisted, pending];
};
packsClient.multicall = async ({ contracts, allowFailure }) => {
  assert.equal(allowFailure, false);
  assert.deepEqual(
    contracts.map(c => c.functionName),
    Array(5).fill("isAllowedToken"),
  );
  assert.deepEqual(
    contracts.map(c => c.args[0]),
    [usdg, stock, weth, delisted, pending],
  );
  return [true, stockAllowed, true, false, false];
};
await assert.rejects(testnetAssets(), /RPC unavailable/);
fail = false;
assert.deepEqual(await testnetAssets(), { usdg, stocks: [stock, weth] });
stockAllowed = false;
assert.deepEqual(await testnetAssets(), { usdg, stocks: [weth] }, "refresh delisting instead of caching forever");
console.log("Registry ABI, payment-token exclusion, pending/delisted filtering, and RPC retry passed.");
