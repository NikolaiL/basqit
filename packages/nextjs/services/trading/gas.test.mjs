import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const address = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
let nativeBalance = 240n,
  allowance = 100n,
  sent = 0,
  estimation,
  query;
const exports = {};
const deps = {
  "@tanstack/react-query": {
    useQuery: options => {
      query = options;
      return options;
    },
  },
  wagmi: {
    useWalletClient: () => ({
      data: {
        getChainId: async () => 4663,
        getAddresses: async () => [address],
        sendTransaction: async () => {
          sent++;
          return "0xhash";
        },
      },
    }),
  },
  viem: { encodeFunctionData: ({ args }) => `approval:${args[1]}` },
  "./useTransactor": { useTransactor: () => action => action() },
  "~~/contracts/externalContracts": { tradeTokenAbi: [] },
  "~~/services/analytics/events": { trackSwap: (_legs, execute) => execute(() => {}) },
  "~~/services/atlas/client": {
    robinhoodChain: { id: 4663 },
    atlasClient: {
      estimateGas: async tx => {
        estimation = tx;
        return 100n;
      },
      estimateFeesPerGas: async () => ({ maxFeePerGas: 2n }),
      getBalance: async () => nativeBalance,
      readContract: async ({ functionName }) => (functionName === "allowance" ? allowance : 1000n),
    },
  },
  "~~/services/trading/quote": { ZEROX_ENABLED: false },
  "~~/services/trading/uniswap": { V3_ROUTER: router },
};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../../hooks/scaffold-eth/useStockTrade.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports, require: name => deps[name] ?? {} },
);
const quote = {
  basqitFee: { bps: 15 },
  provider: "uniswap",
  taker: address,
  spender: router,
  sellToken: token,
  sellAmount: "100",
  expiresAt: Date.now() + 60000,
  transaction: { to: router, data: "0x1234", value: "0" },
};
exports.useTradeGas(quote);
assert.equal(await query.queryFn(), 240n, "fee includes 20% headroom");
assert.equal(estimation.to, router);
allowance = 0n;
assert.equal(await query.queryFn(), 240n);
assert.equal(estimation.to, token);
assert.equal(estimation.data, "approval:100");
allowance = 1n;
await query.queryFn();
assert.equal(estimation.data, "approval:0", "estimate allowance reset as the next action");
allowance = 100n;
nativeBalance = 239n;
await assert.rejects(exports.useStockTrade().swap(quote), /Not enough ETH/);
assert.equal(sent, 0, "do not prompt a transaction with insufficient ETH");
nativeBalance = 240n;
await exports.useStockTrade().swap(quote);
assert.equal(sent, 1);
console.log("Gas: swap, approval/reset, insufficient nonzero balance and sufficient balance passed.");
