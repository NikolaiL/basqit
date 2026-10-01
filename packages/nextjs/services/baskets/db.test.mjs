// Opt-in: runs against the Neon project when DATABASE_URL is set; skipped otherwise so the offline suite stays
// deterministic.
import { earliestSnapshot, hasDatabase, insertSnapshots, readSnapshots } from "./db.ts";
import assert from "node:assert/strict";

if (!hasDatabase()) console.log("Snapshot database check skipped: set DATABASE_URL to run it.");
else {
  const basket = `0xtest${Date.now()}`;
  const points = [
    { at: 1000, value: 5_000_000n, supply: 10n ** 18n, source: "chain" },
    { at: 2000, value: 5_100_000n, supply: 10n ** 18n, source: "cron" },
  ];
  await insertSnapshots(basket, points);
  await insertSnapshots(basket, [{ ...points[0], value: 1n }]); // conflict: ignored
  const rows = await readSnapshots(basket, 0);
  assert.deepEqual(
    rows.map(r => [r.at, r.value, r.source]),
    [
      [1000, 5_000_000n, "chain"],
      [2000, 5_100_000n, "cron"],
    ],
  );
  assert.equal(await earliestSnapshot(basket), 1000);
  await deleteTestRows(basket);
}

// Test rows use a fake address; remove them so the table holds only real baskets.
async function deleteTestRows(basket) {
  const { neon } = await import("@neondatabase/serverless");
  await neon(process.env.DATABASE_URL)`delete from basket_snapshots where basket = ${basket}`;
}
