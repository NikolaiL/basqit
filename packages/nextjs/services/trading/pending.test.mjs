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
  saveBatch,
  readBatch,
  markBatchBought,
} = await import("./pending.ts");

const taker = "0x4b7b07d8baf51975eeab0e1eb4b481a5ac691ed6";
const hash = `0x${"ab".repeat(32)}`;
const trade = { id: "op-1", taker, chainId: 4663, kind: "tx", tokens: ["0x1"], createdAt: 1 };

// A submitted trade with an unknown outcome blocks a second purchase, including after a "reload".
savePendingTrade({ ...trade, ref: hash });
assert.throws(() => assertNoPendingTrade(4663, taker.toUpperCase().replace("0X", "0x")), /still unresolved/);
assert.equal(readPendingTrade(4663, taker).ref, hash);
assert.doesNotThrow(() => assertNoPendingTrade(46630, taker), "other networks are separate");

// Receipt lookups: missing/erroring stays unknown; success and revert resolve.
const pending = readPendingTrade(4663, taker);
const outcome = async (record, lookup) => (await reconcilePendingTrade(record, lookup)).outcome;
assert.equal(await outcome(pending, { receipt: async () => null }), "unknown");
assert.equal(await outcome(pending, { receipt: async () => Promise.reject(new Error("rpc")) }), "unknown");
assert.equal(await outcome(pending, { receipt: async () => ({ status: "success" }) }), "success");
assert.equal(await outcome(pending, { receipt: async () => ({ status: "reverted" }) }), "failure");
assert.equal(await outcome({ ...trade }, { receipt: async () => ({ status: "success" }) }), "unknown");
// No receipt: a used nonce means replaced or dropped; an unused one is still unknown.
const noReceipt = { receipt: async () => null, transaction: async () => ({ nonce: 3 }) };
assert.equal(await outcome(pending, { ...noReceipt, confirmedNonce: async () => 3 }), "unknown");
assert.equal(await outcome(pending, { ...noReceipt, confirmedNonce: async () => 4 }), "replaced");
assert.equal((await reconcilePendingTrade(pending, noReceipt)).nonce, 3, "nonce learned for later");
const bundle = { ...trade, kind: "calls", ref: "0xbundle" };
assert.equal(await outcome(bundle, { receipt: async () => null }), "unknown");
assert.equal(
  await outcome(bundle, { receipt: async () => null, calls: async () => ({ status: "success" }) }),
  "success",
);
assert.equal(
  await outcome(bundle, { receipt: async () => null, calls: async () => ({ status: "pending" }) }),
  "unknown",
);

// An operation clears only its own record, never a newer one.
clearPendingTrade(4663, taker, "op-other");
assert.ok(readPendingTrade(4663, taker), "someone else's clear leaves the record");
clearPendingTrade(4663, taker, "op-1");
assert.equal(readPendingTrade(4663, taker), null);

// Batch legs: marked once, lower-cased, only for the saved batch.
saveBatch({ id: "b1", taker, chainId: 4663, legs: [{ token: "0xaa", sellAmount: "1" }], bought: [], createdAt: 1 });
markBatchBought(4663, taker, "other", ["0xAA"]);
assert.equal(readBatch(4663, taker).bought.length, 0, "a stale batch id marks nothing");
markBatchBought(4663, taker, "b1", ["0xAA"]);
markBatchBought(4663, taker, "b1", ["0xaa"]);
assert.deepEqual([...readBatch(4663, taker).bought], ["0xaa"]);

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
