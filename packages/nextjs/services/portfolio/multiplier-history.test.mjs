import { matchMultiplier } from "./multiplier-history.ts";
import assert from "node:assert/strict";

const event = { id: "one", date: "2026-09-14", status: "CORPORATE_ACTION_STATUS_COMPLETED" };
const update = { effectiveAt: "2026-09-15T15:10:27Z" };
assert.equal(matchMultiplier(event, [event], [update]), update);
assert.equal(matchMultiplier(event, [event], []), undefined);
assert.equal(matchMultiplier(event, [event], [update, { ...update }]), undefined);
assert.equal(matchMultiplier(event, [event, { ...event, id: "other" }], [update]), undefined);
assert.equal(matchMultiplier({ ...event, date: null }, [event], [update]), undefined);
assert.equal(
  matchMultiplier({ ...event, status: "CORPORATE_ACTION_STATUS_IN_PROGRESS" }, [event], [update]),
  undefined,
);
assert.equal(matchMultiplier(event, [event], [{ effectiveAt: "2026-09-03T23:59:59Z" }]), undefined);
assert.equal(matchMultiplier(event, [event], [{ effectiveAt: "2026-09-19T00:00:00Z" }]), undefined);
// Seen live: WDC 9 days early, LHX 3.6 days late over a weekend.
assert.equal(
  matchMultiplier(event, [event], [{ effectiveAt: "2026-09-05T02:34:29Z" }])?.effectiveAt,
  "2026-09-05T02:34:29Z",
);
assert.equal(
  matchMultiplier(event, [event], [{ effectiveAt: "2026-09-17T15:20:27Z" }])?.effectiveAt,
  "2026-09-17T15:20:27Z",
);
console.log("Unique, ambiguous, missing, pending and date-boundary matches passed.");
