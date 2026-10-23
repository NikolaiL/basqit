import { scheduleAddMiniapp } from "./miniapp-runtime.ts";
import assert from "node:assert/strict";
import { mock } from "node:test";

mock.timers.enable({ apis: ["setTimeout"] });
try {
  let calls = 0;
  const prompted = { current: false };
  const add = async () => {
    calls++;
    throw Error("RejectedByUser");
  };
  const context = { client: { added: false } };
  scheduleAddMiniapp(null, prompted, add);
  scheduleAddMiniapp({ client: { added: true } }, prompted, add);
  mock.timers.tick(5000);
  assert.equal(calls, 0, "web and existing users never get prompted");
  const cancel = scheduleAddMiniapp(context, prompted, add);
  cancel();
  mock.timers.tick(5000);
  assert.equal(calls, 0, "cleanup cancels the pending prompt");
  scheduleAddMiniapp(context, prompted, add);
  mock.timers.tick(4999);
  assert.equal(calls, 0);
  mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(calls, 1);
  scheduleAddMiniapp(context, prompted, add);
  mock.timers.tick(10000);
  assert.equal(calls, 1, "declining does not cause another prompt this session");
  console.log("Delayed miniapp prompt: host gating, timing, cleanup and single attempt passed.");
} finally {
  mock.timers.reset();
}
