import {
  discoveryText,
  initializeAnalytics,
  trackDiscovery,
  trackEvent,
  trackFundingResult,
  trackSwap,
} from "./events.ts";
import assert from "node:assert/strict";
import { BaseError, UserRejectedRequestError } from "viem";

// SSR does not need a browser, and early events queue before gtag.js loads.
trackEvent("server_noop");
globalThis.window = {};
trackDiscovery("search", "a".repeat(100) + "б".repeat(80));
initializeAnalytics();
initializeAnalytics();
const commands = () => window.dataLayer.map(args => [...args]);
assert.equal(commands().filter(c => c[0] === "config").length, 1);
assert.equal(commands().find(c => c[0] === "config")[1], "G-0XNNWFK1TV");
const text = "AI companies ".repeat(13).slice(0, 180);
const parts = discoveryText(text);
assert.equal(parts.discovery_text + parts.discovery_text_more, text);
assert.ok(Object.values(parts).every(value => value.length <= 100));
assert.equal(commands().at(-1)[2].discovery_text_more, "б".repeat(80));
const emojiText = "a".repeat(99) + "🚀" + " stocks";
const emojiParts = discoveryText(emojiText);
assert.equal(emojiParts.discovery_text + emojiParts.discovery_text_more, emojiText);
assert.ok(emojiParts.discovery_text.endsWith("🚀"));

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
  "Analytics: queued GA init, full Discover text, batch legs, confirmed/rejected/uncertain swaps and nonblocking delivery passed.",
);
