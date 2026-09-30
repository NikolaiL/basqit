import assert from "node:assert/strict";
import { BaseError, UserRejectedRequestError } from "viem";

// Without a configured ID nothing is queued or sent.
delete process.env.NEXT_PUBLIC_GA_ID;
globalThis.window = {};
const off = await import("./events.ts?unconfigured");
off.trackEvent("anything", { a: 1 });
assert.equal(window.dataLayer, undefined, "analytics stays off without NEXT_PUBLIC_GA_ID");
delete globalThis.window;

process.env.NEXT_PUBLIC_GA_ID = "G-TEST";
const { discoveryShape, initializeAnalytics, trackDiscovery, trackEvent, trackFundingResult, trackSwap } =
  await import("./events.ts");

// SSR does not need a browser, and early events queue before gtag.js loads.
trackEvent("server_noop");
globalThis.window = {};
const secret = "my savings are at 0x1111111111111111111111111111111111111111";
trackDiscovery("search", secret);
initializeAnalytics();
initializeAnalytics();
const commands = () => window.dataLayer.map(args => [...args]);
assert.equal(commands().filter(c => c[0] === "config").length, 1);
assert.equal(commands().find(c => c[0] === "config")[1], "G-TEST");
// Typed discovery text never leaves the browser; only a coarse length bucket does.
assert.deepEqual(commands().at(-1)[2], { discovery_length: "21-60" });
assert.ok(!JSON.stringify(window.dataLayer).includes("savings"));
assert.deepEqual(discoveryShape(""), { discovery_length: "0" });
assert.deepEqual(discoveryShape("AI"), { discovery_length: "1-20" });
assert.deepEqual(discoveryShape("🚀".repeat(21)), { discovery_length: "21-60" });

const legs = [
  { swap_type: "batch", sell_token: "USDG", buy_token: "AAPL" },
  { swap_type: "batch", sell_token: "USDG", buy_token: "NVDA" },
];
for (const [name, params, action, stages] of [
  [
    "confirmed atomic purchase",
    legs,
    async sent => {
      sent();
      return "hash";
    },
    ["started", "submitted", "confirmed"],
  ],
  [
    "funding origin is not destination success",
    [{ swap_type: "funding" }],
    async sent => {
      sent();
    },
    ["started", "submitted", "origin_confirmed"],
  ],
  [
    "wallet rejection",
    legs.slice(0, 1),
    async () => {
      throw new BaseError("send failed", { cause: new UserRejectedRequestError(new Error("cancel")) });
    },
    ["started", "rejected"],
  ],
  [
    "preflight failure",
    legs.slice(0, 1),
    async () => {
      throw new Error("insufficient funds");
    },
    ["started", "failed"],
  ],
  [
    "receipt timeout is not failed swap",
    legs.slice(0, 1),
    async sent => {
      sent();
      throw new Error("timeout");
    },
    ["started", "submitted", "status_unknown"],
  ],
  [
    "confirmed revert",
    legs.slice(0, 1),
    async sent => {
      sent();
      throw new Error("Transaction reverted");
    },
    ["started", "submitted", "failed"],
  ],
  ["no hash never counts as success", legs.slice(0, 1), async () => {}, ["started", "not_submitted"]],
]) {
  window.dataLayer.length = 0;
  await trackSwap(params, action).catch(() => {});
  const events = commands();
  assert.deepEqual(
    events.map(c => c[1]),
    stages.flatMap(stage => params.map(() => `swap_${stage}`)),
    name,
  );
  assert.equal(new Set(events.map(c => c[2].attempt_id)).size, 1, "same attempt across legs and stages");
  assert.ok(events.every(c => c[2].token_count === params.length));
}

const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
window.dataLayer.length = 0;
trackFundingResult("hash", "ETH", 8453, "bridge_pending");
trackFundingResult("hash", "ETH", 8453, "bridge_filled");
trackFundingResult("hash", "ETH", 8453, "bridge_filled");
assert.equal(commands().length, 1, "polling and remounts must not count completion twice");
assert.equal(commands()[0][2].status, "bridge_filled");
window.gtag = () => {
  throw new Error("analytics blocked");
};
assert.equal(
  await trackSwap(legs, async sent => {
    sent();
    return "executed";
  }),
  "executed",
);
const original = new Error("wallet failure");
await assert.rejects(
  trackSwap(legs, async () => {
    throw original;
  }),
  error => error === original,
);
console.log(
  "Analytics: opt-in GA init, no Discover text, batch legs, confirmed/rejected/uncertain swaps and nonblocking delivery passed.",
);
