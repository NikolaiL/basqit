import {
  EMPTY_PROFILE,
  checkIssuedAt,
  cleanDescription,
  cleanProfile,
  descriptionMessage,
  profileMessage,
} from "./profile.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

test("cleanProfile trims, drops unknown fields and rejects unsafe input", () => {
  const p = cleanProfile({ name: "  Ada   L ", x: "@ada_l", website: "https://ada.dev", extra: 1 });
  assert.deepEqual(p, { ...EMPTY_PROFILE, name: "Ada L", website: "https://ada.dev" });
  assert.throws(() => cleanProfile({ website: "javascript:alert(1)" }), /https/);
  assert.throws(() => cleanProfile({ website: "http://ada.dev" }), /https/);
  assert.throws(() => cleanProfile({ bio: "x".repeat(281) }), /280/);
  assert.throws(() => cleanProfile({ avatar: "data:image/svg+xml;base64,PHN2Zz4=" }), /picture/);
  assert.equal(cleanProfile({ avatar: "data:image/webp;base64,AAAA" }).avatar, "data:image/webp;base64,AAAA");
  assert.throws(() => cleanDescription("x".repeat(601)), /600/);
});

test("a signed profile verifies only for the same wallet and same content", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const p = cleanProfile({ name: "Ada", bio: "Line one\nX: @mallory" });
  const at = new Date().toISOString();
  const message = profileMessage(account.address, p, at);
  const signature = await account.signMessage({ message });
  assert.ok(await verifyMessage({ address: account.address, message, signature }));
  assert.ok(
    !(await verifyMessage({ address: other.address, message: profileMessage(other.address, p, at), signature })),
  );
  const changed = profileMessage(account.address, { ...p, bio: "Different" }, at);
  assert.ok(!(await verifyMessage({ address: account.address, message: changed, signature })));
  // A description signature is bound to its basket.
  const d = descriptionMessage(46630, other.address, "Idea", at);
  const ds = await account.signMessage({ message: d });
  const moved = descriptionMessage(46630, account.address, "Idea", at);
  assert.ok(!(await verifyMessage({ address: account.address, message: moved, signature: ds })));
});

test("checkIssuedAt rejects stale, future, malformed and replayed timestamps", () => {
  const now = Date.parse("2026-10-02T12:00:00.000Z");
  const iso = ms => new Date(ms).toISOString();
  assert.equal(checkIssuedAt(iso(now - 1000), now).getTime(), now - 1000);
  assert.throws(() => checkIssuedAt(iso(now - 11 * 60_000), now), /expired/);
  assert.throws(() => checkIssuedAt(iso(now + 5 * 60_000), now), /expired/);
  assert.throws(() => checkIssuedAt("2026-10-02", now), /Invalid/);
  assert.throws(() => checkIssuedAt(iso(now - 1000), now, new Date(now - 1000)), /newer/);
  assert.ok(checkIssuedAt(iso(now), now, new Date(now - 1000)));
});
