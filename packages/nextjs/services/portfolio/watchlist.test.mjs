import { parseWallets, saveWallet } from "./watchlist.ts";
import assert from "node:assert/strict";

const address = "0xfce637eead7d62d9ed27f81d9767de03e9e534cf";
const first = saveWallet([], address, "  Pool  ");
assert.equal(first[0].name, "Pool");
const updated = saveWallet(first, first[0].address, "Renamed");
assert.equal(updated.length, 1);
assert.equal(updated[0].name, "Renamed");
assert.deepEqual(parseWallets(JSON.stringify(updated)), updated);
assert.equal(parseWallets(JSON.stringify([...updated, ...updated, { address: "bad", name: "x" }])).length, 1);
assert.deepEqual(parseWallets(null), []);
assert.deepEqual(parseWallets(JSON.stringify([{}, null, { address: 12, name: "x" }])), []);
assert.throws(() => parseWallets("bad json"));
assert.throws(() => parseWallets("{}"));
assert.throws(() => saveWallet([], "bad", "x"));
console.log("Wallet persistence, validation and duplicate checks passed.");
