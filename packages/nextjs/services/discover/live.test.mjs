// Opt-in smoke check: uses the running server and its configured Jev account.
import assert from "node:assert/strict";

const origin = process.env.DISCOVERY_TEST_ORIGIN || "http://localhost:3000";
for (const theme of [
  "companies with crazy founders",
  "companies that started in a garage",
  "guaranteed profit tomorrow",
]) {
  const response = await fetch(`${origin}/api/discover?${new URLSearchParams({ theme })}`);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(result.matches.length <= 8);
  assert.equal(new Set(result.matches.map(match => match.symbol)).size, result.matches.length);
  if (theme.startsWith("guaranteed")) assert.equal(result.matches.length, 0);
  else assert.ok(result.matches.length > 0, `No matches: ${theme}`);
  console.log(theme, result.matches.map(match => match.symbol).join(", "));
}
