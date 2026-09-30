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
  query,
  receiptFails = false,
  receipt = null,
  seenNonce = null,
  seenTx = null,
  confirmedNonce = 0;
const queries = {};
const replacementHash = `0x${"c".repeat(64)}`;
// Web Locks with `ifAvailable`, shared by every hook instance: the browser's per-origin lock manager.
const held = new Set();
const navigator = {
  locks: {
    request: async (name, _options, callback) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  },
};
const storage = new Map();
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
const load = (path, context) => {
  const moduleExports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: moduleExports, ...context },
  );
  return moduleExports;
};
const exports = {};
const deps = {
  "@tanstack/react-query": {
    useQuery: options => {
      options.refetch = async () => {};
      queries[options.queryKey[0]] = options;
      if (options.queryKey[0] === "trade-gas") query = options;
      return options;
    },
    useQueryClient: () => ({ setQueryData: () => {}, invalidateQueries: async () => {} }),
  },
  react: { useEffect: () => {} },
  wagmi: {
    useWalletClient: () => ({
      data: {
        getChainId: async () => 4663,
        getAddresses: async () => [address],
        sendTransaction: async () => {
          sent++;
          // Let a concurrent caller run while the wallet is open.
          await new Promise(resolve => setTimeout(resolve, 5));
          return `0x${String(sent).padStart(64, "0")}`;
        },
      },
    }),
  },
  viem: { encodeFunctionData: ({ args }) => `approval:${args[1]}` },
  // Like the real transactor: the wallet broadcasts, then a receipt timeout throws without returning the hash.
  "./useTransactor": {
    useTransactor: () => async action => {
      const hash = await action();
      if (receiptFails) throw new Error("Timed out while waiting for transaction");
      return hash;
    },
  },
  "~~/services/trading/pending": load("./pending.ts", { localStorage, navigator }),
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
      getTransactionReceipt: async () => receipt,
      // A pasted replacement is visible under its own hash only; the original under the original.
      getTransaction: async ({ hash }) =>
        seenTx && hash === replacementHash ? seenTx : seenNonce === null ? null : { nonce: seenNonce },
      getTransactionCount: async () => confirmedNonce,
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
assert.equal(storage.size, 0, "a confirmed swap leaves no pending record");

// T1: a broadcast swap whose receipt lookup fails must block a retry instead of buying twice.
receiptFails = true;
await assert.rejects(exports.useStockTrade().swap(quote), /Timed out/);
assert.equal(sent, 2);
assert.match([...storage.values()][0], /"ref":"0x0{63}2"/, "the submitted hash is kept");
receiptFails = false;
await assert.rejects(exports.useStockTrade().swap(quote), /still unresolved/);
assert.equal(sent, 2, "no second wallet send while the first outcome is unknown");
const pending = deps["~~/services/trading/pending"];
const hook = exports.usePendingTrade;
const reconcile = () => (hook(address), queries["pending-trade"].queryFn());

// F3: the hash was replaced or dropped (no receipt, nonce used). Not cleared automatically: a speed-up may have
// bought. The nonce learned while the transaction was visible is kept.
seenNonce = 7;
assert.equal((await reconcile()).outcome, "unknown", "nonce not used yet");
assert.equal(pending.readPendingTrade(4663, address).nonce, 7);
seenNonce = null;
confirmedNonce = 8;
assert.equal((await reconcile()).outcome, "replaced");
assert.ok(pending.readPendingTrade(4663, address), "replaced trade still blocks until the buyer checks history");
pending.clearPendingTrade(4663, address);
confirmedNonce = 0;

// F1: A confirms, B broadcasts and times out, the dialog is closed, B confirms late; only C may be bought again.
const [A, B, C] = ["0xa", "0xb", "0xc"].map(t => t.padEnd(42, "0"));
pending.saveBatch({
  id: "batch-1",
  taker: address,
  chainId: 4663,
  legs: [A, B, C].map(t => ({ token: t, sellAmount: "1000000" })),
  bought: [],
  createdAt: 1,
});
await exports.useStockTrade().swap({ ...quote, buyToken: A }, "batch-1");
receiptFails = true;
await assert.rejects(exports.useStockTrade().swap({ ...quote, buyToken: B }, "batch-1"), /Timed out/);
receiptFails = false;
assert.deepEqual(
  [...pending.readBatch(4663, address).bought],
  [A],
  "only confirmed legs are marked before reconciling",
);
receipt = { status: "success" };
assert.equal(await reconcile(), null, "late success resolves the record");
receipt = null;
const batch = pending.readBatch(4663, address);
assert.deepEqual([...batch.bought], [A, B], "late success marks its leg bought, surviving the closed dialog");
assert.deepEqual(
  [...batch.legs.filter(leg => !batch.bought.includes(leg.token)).map(leg => leg.token)],
  [C],
  "only C remains, at its original allocation",
);
pending.clearBatch(4663, address);

// A pasted cancellation hash confirms, but it is not the purchase: B stays unbought until the buyer answers, and
// the two answers are recorded differently. A pasted sped-up copy of the same call does count.
// The hook with its query's current data loaded, as the dialog would render it.
const loadedHook = async () => {
  const hookResult = exports.usePendingTrade(address);
  const own = queries["pending-trade"];
  own.data = await own.queryFn();
  return hookResult;
};
const pendingFor = token => {
  pending.saveBatch({
    id: "batch-2",
    taker: address,
    chainId: 4663,
    legs: [token].map(t => ({ token: t, sellAmount: "1" })),
    bought: [],
    createdAt: 1,
  });
  pending.savePendingTrade({
    id: "op-b",
    taker: address,
    chainId: 4663,
    kind: "tx",
    ref: `0x${"b".repeat(64)}`,
    tokens: [token],
    batch: "batch-2",
    to: router,
    data: "0x1234",
    createdAt: 1,
  });
};
const replacement = replacementHash;
const track = async () => {
  (await loadedHook()).track(replacement);
  receipt = { status: "success" };
  const result = await reconcile();
  receipt = null;
  return result;
};
pendingFor(B);
seenTx = { nonce: 9, from: address, to: address, input: "0x" };
assert.equal((await track()).outcome, "unverified", "a cancellation is not the purchase");
assert.equal(pending.readBatch(4663, address).bought.length, 0, "nothing marked bought");
(await loadedHook()).resolve(false);
assert.equal(pending.readPendingTrade(4663, address), null);
assert.equal(pending.readBatch(4663, address).bought.length, 0, "'nothing was bought' marks nothing");
// The same call under another nonce is a different, earlier or later purchase, not this one's replacement.
pendingFor(B);
const withNonce = pending.readPendingTrade(4663, address);
pending.savePendingTrade({ ...withNonce, nonce: 9 });
seenTx = { nonce: 4, from: address, to: router, input: "0x1234" };
assert.equal((await track()).outcome, "unverified", "identical call, other nonce");
assert.equal(pending.readBatch(4663, address).bought.length, 0);
pending.clearPendingTrade(4663, address);
pendingFor(B);
pending.savePendingTrade({ ...pending.readPendingTrade(4663, address), nonce: 9 });
seenTx = { nonce: 9, from: address, to: router, input: "0x1234" };
assert.equal(await track(), null, "a sped-up copy of the same call settles the purchase");
assert.deepEqual([...pending.readBatch(4663, address).bought], [B]);
pendingFor(C);
seenTx = null;
(await loadedHook()).resolve(true);
assert.deepEqual([...pending.readBatch(4663, address).bought], [C], "'went through' marks the legs bought");
pending.clearBatch(4663, address);

// Resuming with only a subset: A bought, B and C remain, only C is bought now. B and its allocation stay saved.
pending.saveBatch({
  id: "batch-3",
  taker: address,
  chainId: 4663,
  legs: [A, B, C].map(t => ({ token: t, sellAmount: "1000000" })),
  bought: [A],
  createdAt: 1,
});
await exports.useStockTrade().swap({ ...quote, buyToken: C }, "batch-3");
const afterSubset = pending.readBatch(4663, address);
assert.deepEqual([...afterSubset.bought], [A, C]);
assert.deepEqual(
  [...afterSubset.legs.filter(leg => !afterSubset.bought.includes(leg.token)).map(leg => leg.token)],
  [B],
  "B's unfinished allocation survives a subset purchase",
);
assert.ok(pending.readActiveBatch(4663, address), "an unfinished batch stays active");
await exports.useStockTrade().swap({ ...quote, buyToken: B }, "batch-3");
assert.equal(pending.readActiveBatch(4663, address), null, "finished once every saved leg is bought");
assert.equal(pending.readBatch(4663, address), null, "and only then removed");

// F2: two callers (dialogs or tabs) for one wallet: only one may reach the wallet.
const before = sent;
const both = await Promise.allSettled([exports.useStockTrade().swap(quote), exports.useStockTrade().swap(quote)]);
assert.equal(sent - before, 1, "one wallet send");
assert.equal(both.filter(result => result.status === "rejected").length, 1);
assert.match(String(both.find(result => result.status === "rejected").reason), /another tab|still unresolved/);
console.log(
  "Gas and recovery: swap, approval/reset, ETH checks, no retry after receipt failure, replaced hash, late batch leg, cancellation hash, nonce binding, manual answers, subset resume and single submitter passed.",
);
