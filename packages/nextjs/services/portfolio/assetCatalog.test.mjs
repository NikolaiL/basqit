import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
let holdings;
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../../components/atlas/AssetCatalog.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText,
  {
    exports,
    require: name => {
      if (name === "react" || name === "react/jsx-runtime") return require(name);
      if (name === "wagmi") return { useAccount: () => ({ address: "wallet" }) };
      if (name.includes("useStockPortfolio"))
        return { useStockPortfolio: () => ({ data: holdings === undefined ? undefined : { holdings } }) };
      if (name.includes("/format")) return { money: value => `$${value}` };
      if (name.includes("TokenAmount")) return { TokenAmount: ({ value }) => value };
      return { StockLogo: () => null };
    },
  },
);
const asset = { symbol: "AAPL", name: "Apple", address: "0xAbC", status: "Active", price: "100" };
const render = () => renderToStaticMarkup(React.createElement(exports.AssetCatalog, { assets: [asset] }));
assert.match(render(), /Buy AAPL/);
assert.doesNotMatch(render(), /Sell AAPL|You own|bq-asset-owned/);
holdings = [{ address: "0xabc", balance: "2", valueUsd: "200" }];
assert.match(render(), /Sell AAPL/);
assert.match(render(), /bq-asset-owned/);
assert.match(render(), /You own/);
assert.match(render(), /≈\$200/);
holdings = [{ address: "0xabc", balance: "0", valueUsd: "0" }];
assert.doesNotMatch(render(), /Sell AAPL|You own|bq-asset-owned/);
holdings = undefined;
assert.doesNotMatch(render(), /Sell AAPL|You own|bq-asset-owned/);
console.log(
  "Catalog: Buy always available, own positive balance matched by address, Sell/highlight removed without balance.",
);
