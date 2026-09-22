import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { BaseError, UserRejectedRequestError } from "viem";

const wallet = "0x1111111111111111111111111111111111111111";
const native = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const hash = `0x${"1".repeat(64)}`;
let sendError, receiptError;
const exports = {};
const dependencies = {
  "~~/services/analytics/events": { trackSwap: (_legs, execute) => execute(() => {}) },
  viem: {
    BaseError,
    http: () => {},
    createPublicClient: () => ({
      getBalance: async () => 1000n,
      estimateGas: async () => 1n,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1n }),
    }),
  },
  wagmi: { useConfig: () => ({}), useWalletClient: () => ({ data: {} }) },
  "wagmi/actions": {
    getWalletClient: async () => ({
      getChainId: async () => 8453,
      getAddresses: async () => [wallet],
      sendTransaction: async () => {
        if (sendError) throw sendError;
        return hash;
      },
    }),
  },
  "./useTransactor": {
    useTransactor: () => async action => {
      const result = await action();
      if (receiptError) throw receiptError;
      return result;
    },
  },
  "~~/services/funding/shared": {
    NATIVE: native,
    fundingChains: [{ id: 8453 }],
    assertFundingGasReserve: () => {},
  },
};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../../hooks/scaffold-eth/useFundingTransfer.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, require: name => dependencies[name] },
);
const quote = {
  chainId: 8453,
  wallet,
  token: native,
  expiresAt: Date.now() + 60000,
  transaction: { to: wallet, data: "0x", value: "1" },
  basqitFee: { bps: 15 },
};
for (const [name, sending, receipt, expected] of [
  ["raw rejection returns to converter", { code: 4001 }, null, ["saved", "rejected"]],
  [
    "nested viem rejection returns to converter",
    new BaseError("send failed", {
      cause: new UserRejectedRequestError(new Error("User rejected")),
    }),
    null,
    ["saved", "rejected"],
  ],
  ["ambiguous transport failure preserves recovery", new Error("connection lost"), null, ["saved"]],
  ["message alone must not clear recovery", new Error("User rejected"), null, ["saved"]],
  ["receipt failure preserves submitted hash", null, { code: 4001 }, ["saved", hash]],
  ["successful send preserves tracking", null, null, ["saved", hash]],
]) {
  sendError = sending;
  receiptError = receipt;
  const events = [];
  const result = exports.useFundingTransfer().send(
    quote,
    () => events.push("saved"),
    txHash => events.push(txHash),
    () => events.push("rejected"),
  );
  if (sending || receipt) await assert.rejects(result);
  else await result;
  assert.deepEqual(events, expected, name);
}
console.log("Funding rejection: explicit cancellation resets intent; uncertain sends and submitted hashes retained.");
