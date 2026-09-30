import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let modal,
  miniApp = false,
  connected = false,
  miniConnects = 0;
const exports = {};
const code = ts.transpileModule(
  readFileSync(new URL("../../hooks/scaffold-eth/useWalletConnectModal.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
vm.runInNewContext(code, {
  exports,
  require: name =>
    ({
      "@rainbow-me/rainbowkit": { useConnectModal: () => modal },
      wagmi: { useAccount: () => ({ isConnected: connected }) },
      "~~/components/MiniappProvider": {
        useMiniapp: () => ({ isMiniApp: miniApp, connectWallet: async () => void miniConnects++ }),
      },
    })[name] ?? assert.fail(`unexpected import ${name}`),
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
// Inside a Mini App host the host wallet connects directly; no RainbowKit dialog is ever shown.
miniApp = true;
modal = { connectModalOpen: true, openConnectModal: open };
const hosted = exports.useWalletConnectModal();
assert.equal(hosted.connectModalOpen, false);
hosted.openConnectModal();
assert.equal(miniConnects, 1);
connected = true;
assert.equal(exports.useWalletConnectModal().openConnectModal, open, "connected Mini App keeps the normal modal");
console.log("Wallet modal visibility: selection, manual sign-in, auto-sign and stale flag after wallet switch passed");
