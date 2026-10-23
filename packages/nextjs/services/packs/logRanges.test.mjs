import { withLogRanges } from "./logRanges.ts";
import assert from "node:assert/strict";

const calls = [];
const head = 141252209n;
const request = withLogRanges(async args => {
  calls.push(args);
  if (args.method === "eth_blockNumber") return `0x${head.toString(16)}`;
  return [args.params[0]];
});
const filter = { address: "0x123", topics: ["0xabc"], fromBlock: "0x7931d75" };
const logs = await request({ method: "eth_getLogs", params: [filter] });
assert.equal(logs.length, 2);
assert.equal(calls.filter(c => c.method === "eth_blockNumber").length, 1);
assert.equal(logs[0].fromBlock, filter.fromBlock);
assert.equal(BigInt(logs[0].toBlock) + 1n, BigInt(logs[1].fromBlock));
assert.equal(BigInt(logs[1].toBlock), head);
for (const log of logs) {
  assert.ok(BigInt(log.toBlock) - BigInt(log.fromBlock) + 1n <= 10_000_000n);
  assert.equal(log.address, filter.address);
  assert.deepEqual(log.topics, filter.topics);
}
for (const count of [1n, 10_000_000n, 10_000_001n]) {
  const logs = await request({
    method: "eth_getLogs",
    params: [{ fromBlock: "0x0", toBlock: `0x${(count - 1n).toString(16)}` }],
  });
  assert.equal(logs.length, count > 10_000_000n ? 2 : 1);
}
const byHash = { method: "eth_getLogs", params: [{ blockHash: "0xabc" }] };
await request(byHash);
assert.equal(calls.at(-1), byHash);
const fail = withLogRanges(async () => {
  throw new Error("RPC unavailable");
});
await assert.rejects(fail({ method: "eth_getLogs", params: [filter] }), /RPC unavailable/);
console.log("Log ranges: complete coverage, inclusive boundaries, preserved filters and RPC failures passed.");
