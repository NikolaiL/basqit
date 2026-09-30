// Opt-in smoke check: uses a running server and its configured provider account.
// Run with DISCOVERY_TEST_ORIGIN=http://localhost:3000; skipped otherwise so the offline suite stays deterministic.
import assert from "node:assert/strict";

const origin = process.env.DISCOVERY_TEST_ORIGIN;
if (!origin) console.log("Live discovery check skipped: set DISCOVERY_TEST_ORIGIN to run it.");
for (const theme of !origin
  ? []
  : ["companies with crazy founders", "companies that started in a garage", "guaranteed profit tomorrow"]) {
  const response = await fetch(`${origin}/api/discover?${new URLSearchParams({ theme })}`);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(result.matches.length <= 8);
  assert.equal(new Set(result.matches.map(match => match.symbol)).size, result.matches.length);
  if (theme.startsWith("guaranteed")) assert.equal(result.matches.length, 0);
  else assert.ok(result.matches.length > 0, `No matches: ${theme}`);
  console.log(theme, result.matches.map(match => match.symbol).join(", "));
}
