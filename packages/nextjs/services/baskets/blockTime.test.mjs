import { blockTimes } from "./blockTime.ts";
import assert from "node:assert/strict";

// The testnet RPC sends blockTimestamp "0x0" on logs: zero means unknown, so the block's own time is used.
const asked = [];
const timeOf = blockTimes(async number => {
  asked.push(number);
  return { timestamp: 1_790_000_000n + number };
});
assert.equal(await timeOf({ blockNumber: 5n, blockTimestamp: 0n }), 1_790_000_005);
assert.equal(await timeOf({ blockNumber: 5n, blockTimestamp: null }), 1_790_000_005);
assert.equal(await timeOf({ blockNumber: 7n }), 1_790_000_007);
// A real timestamp on the log is used as is.
assert.equal(await timeOf({ blockNumber: 9n, blockTimestamp: 1_800_000_000n }), 1_800_000_000);
// Each block is fetched once.
assert.deepEqual(asked, [5n, 7n]);

// A failed read is not cached: the next request for that block tries again.
let fail = true;
const flaky = blockTimes(async number => {
  if (fail) throw new Error("timeout");
  return { timestamp: number };
});
await assert.rejects(flaky({ blockNumber: 11n }), /timeout/);
fail = false;
assert.equal(await flaky({ blockNumber: 11n }), 11);
