import { holdersFromTransfers, mergeActivity } from "./activity.ts";
import assert from "node:assert/strict";

const zero = "0x0000000000000000000000000000000000000000";
const router = "0xrouter";
assert.deepEqual(
  holdersFromTransfers(
    [
      { from: zero, to: router, value: 5n },
      { from: router, to: "0xAlice", value: 5n },
      { from: zero, to: "0xbob", value: 9n },
      { from: "0xalice", to: zero, value: 5n },
    ],
    [router],
  ),
  [{ address: "0xbob", shares: 9n }],
);

const rows = [
  { at: 1, hash: "0x1", kind: "created", who: "0xc" },
  { at: 2, hash: "0x2", kind: "minted", who: "0xr", shares: 1n },
  { at: 2, hash: "0x2", kind: "bought", who: "0xa", shares: 1n, usdg: 5n },
  { at: 3, hash: "0x3", kind: "minted", who: "0xb", shares: 2n },
];
assert.deepEqual(
  mergeActivity(rows).map(r => [r.hash, r.kind]),
  [
    ["0x3", "minted"],
    ["0x2", "bought"],
    ["0x1", "created"],
  ],
);
