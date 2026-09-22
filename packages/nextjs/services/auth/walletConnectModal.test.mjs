import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let modal;
const exports = {};
const code = ts.transpileModule(
  readFileSync(new URL("../../hooks/scaffold-eth/useWalletConnectModal.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
vm.runInNewContext(code, {
  exports,
  require: name => {
    assert.equal(name, "@rainbow-me/rainbowkit");
    return { useConnectModal: () => modal };
  },
});
const open = () => {};
for (const [name, rawOpen, openConnectModal, expected] of [
  ["wallet selection visible", true, open, true],
  ["manual sign-in visible", true, open, true],
  ["connect dialog closed", false, open, false],
  ["automatic signature pending", true, undefined, false],
  ["signed in after wallet switch, stale open flag", true, undefined, false],
]) {
  modal = { connectModalOpen: rawOpen, openConnectModal };
  const result = exports.useWalletConnectModal();
  assert.equal(result.connectModalOpen, expected, name);
  assert.equal(result.openConnectModal, openConnectModal, "preserve connection action");
}
console.log("Wallet modal visibility: selection, manual sign-in, auto-sign and stale flag after wallet switch passed");
