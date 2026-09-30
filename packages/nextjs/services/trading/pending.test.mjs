import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key),
};
const {
  assertNoPendingTrade,
  clearPendingTrade,
  isUnsupportedBatch,
  provesNotSent,
  readPendingTrade,
  reconcilePendingTrade,
  savePendingTrade,
} = await import("./pending.ts");

const taker = "0x4b7b07d8baf51975eeab0e1eb4b481a5ac691ed6";
const hash = `0x${"ab".repeat(32)}`;
const trade = { taker, chainId: 4663, kind: "tx", tokens: ["0x1"], createdAt: 1 };

// A submitted trade with an unknown outcome blocks a second purchase, including after a "reload".
savePendingTrade({ ...trade, ref: hash });
assert.throws(() => assertNoPendingTrade(4663, taker.toUpperCase().replace("0X", "0x")), /still unresolved/);
assert.equal(readPendingTrade(4663, taker).ref, hash);
assert.doesNotThrow(() => assertNoPendingTrade(46630, taker), "other networks are separate");

// Receipt lookups: missing/erroring stays unknown; success and revert resolve.
const pending = readPendingTrade(4663, taker);
assert.equal(await reconcilePendingTrade(pending, { receipt: async () => null }), "unknown");
assert.equal(
  await reconcilePendingTrade(pending, { receipt: async () => Promise.reject(new Error("rpc")) }),
  "unknown",
);
assert.equal(await reconcilePendingTrade(pending, { receipt: async () => ({ status: "success" }) }), "success");
assert.equal(await reconcilePendingTrade(pending, { receipt: async () => ({ status: "reverted" }) }), "failure");
assert.equal(await reconcilePendingTrade({ ...trade }, { receipt: async () => ({ status: "success" }) }), "unknown");
const bundle = { ...trade, kind: "calls", ref: "0xbundle" };
assert.equal(await reconcilePendingTrade(bundle, { receipt: async () => null }), "unknown");
assert.equal(
  await reconcilePendingTrade(bundle, { receipt: async () => null, calls: async () => ({ status: "success" }) }),
  "success",
);
assert.equal(
  await reconcilePendingTrade(bundle, { receipt: async () => null, calls: async () => ({ status: "pending" }) }),
  "unknown",
);
clearPendingTrade(4663, taker);
assert.equal(readPendingTrade(4663, taker), null);

// Tampered record fails closed.
store.set(
  `basqit-trade-v1:4663:${taker}`,
  JSON.stringify({ ...trade, taker: "0x0000000000000000000000000000000000000001" }),
);
assert.throws(() => readPendingTrade(4663, taker), /invalid/);
store.clear();

// EIP-5792: only genuine unsupported-batch errors fall back; 5750 (user refused) and 5720 (duplicate id) do not.
for (const code of [5700, 5710, 5740, 5760]) assert.equal(isUnsupportedBatch({ code }), true, String(code));
for (const code of [5720, 5730, 5750, 4001, 4100, -32603])
  assert.equal(isUnsupportedBatch({ code }), false, String(code));
assert.equal(isUnsupportedBatch({ cause: { cause: { code: 5750 } } }), false);
assert.equal(provesNotSent({ cause: { code: 4001 } }), true);
assert.equal(provesNotSent({ code: 5750 }), true);
assert.equal(provesNotSent({ code: 5720 }), false, "duplicate id means something was already sent");
assert.equal(provesNotSent(new Error("timeout")), false);
console.log("Pending trade record blocks retries until reconciled; batch fallback is limited to unsupported shapes.");
