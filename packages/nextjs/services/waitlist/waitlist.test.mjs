import { parseWaitlist, waitlistSegment } from "./waitlist.ts";
import assert from "node:assert/strict";

assert.deepEqual(parseWaitlist({ email: " Ann@Example.com ", product: "packs" }), {
  email: "ann@example.com",
  product: "packs",
});
assert.equal(parseWaitlist({ email: "not-an-email", product: "packs" }), null);
assert.equal(parseWaitlist({ email: "a@b.co", product: "drops" }), null);
assert.equal(parseWaitlist({ email: `${"a".repeat(250)}@b.co`, product: "baskets" }), null);
assert.equal(parseWaitlist(null), null);
const env = { RESEND_SEGMENT_BASKETS: "seg_b", RESEND_SEGMENT_PACKS: "seg_p" };
assert.equal(waitlistSegment("baskets", env), "seg_b");
assert.equal(waitlistSegment("packs", env), "seg_p");
assert.equal(waitlistSegment("packs", {}), undefined);
console.log("Waitlist validation and segment mapping passed.");
