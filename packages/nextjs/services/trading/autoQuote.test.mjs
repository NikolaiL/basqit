import { watchQuote } from "./autoQuote.ts";
import assert from "node:assert/strict";
import { mock } from "node:test";

const originalFetch = globalThis.fetch;
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
const flush = () => new Promise(resolve => setImmediate(resolve));
try {
  let calls = 0;
  const states = [];
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ expiresAt: Date.now() + 1000 }) };
  };
  const canceled = watchQuote("amount=1", state => states.push(state));
  mock.timers.tick(250);
  canceled();
  const stop = watchQuote("amount=2", state => states.push(state));
  mock.timers.tick(499);
  await flush();
  assert.equal(calls, 0);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls, 1);
  assert.equal(states.at(-1).loading, false);
  mock.timers.tick(999);
  await flush();
  assert.equal(calls, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls, 2);
  stop();
  mock.timers.tick(2000);
  await flush();
  assert.equal(calls, 2);
  let resolveFetch;
  let signal;
  globalThis.fetch = (_, options) => {
    signal = options.signal;
    return new Promise(resolve => {
      resolveFetch = resolve;
    });
  };
  const late = [];
  const cancel = watchQuote("amount=3", state => late.push(state));
  mock.timers.tick(500);
  cancel();
  assert.equal(signal.aborted, true);
  resolveFetch({ ok: true, json: async () => ({ expiresAt: Date.now() + 1000 }) });
  await flush();
  assert.ok(late.every(state => !state.quote));
  let errors = 0;
  globalThis.fetch = async () => {
    errors++;
    return { ok: false, json: async () => ({ error: "Unavailable" }) };
  };
  const failed = [];
  const end = watchQuote("amount=4", state => failed.push(state));
  mock.timers.tick(500);
  await flush();
  assert.equal(failed.at(-1).error, "Unavailable");
  mock.timers.tick(60000);
  await flush();
  assert.equal(errors, 1);
  end();
  console.log(
    "Automatic quotes: debounce, expiry refresh, cancellation, late-response rejection, and no error retry loop passed.",
  );
} finally {
  globalThis.fetch = originalFetch;
  mock.timers.reset();
}
