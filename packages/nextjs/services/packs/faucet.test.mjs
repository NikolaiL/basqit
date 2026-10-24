import { faucetAvailability } from "./faucet.ts";
import assert from "node:assert/strict";

const config = {
  lastDrip: 1000n,
  cooldown: 60n,
  now: 1059n,
  amount: 10_000_000_000n,
  dailyCap: 1_000_000_000_000n,
  minted: 0n,
};
assert.deepEqual(faucetAvailability(config), { wait: 1n, capped: false, ready: false });
assert.equal(faucetAvailability({ ...config, now: 1060n }).ready, true);
assert.equal(faucetAvailability({ ...config, lastDrip: 0n, now: 1n }).ready, true);
assert.equal(faucetAvailability({ ...config, now: 1060n, minted: config.dailyCap - config.amount }).ready, true);
assert.deepEqual(faucetAvailability({ ...config, now: 1060n, minted: config.dailyCap }), {
  wait: 0n,
  capped: true,
  ready: false,
});
// Use the chain's clock, even when the browser's wall clock is ahead on a local fork.
assert.equal(faucetAvailability({ ...config, now: 1000n }).wait, 60n);
