import { tradingSessions } from "./tradingSessions.ts";
import assert from "node:assert/strict";

const sessions = tradingSessions({
  market: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_UNTRADABLE" },
  extended: { whole: "unexpected", fractional: null },
});
assert.equal(sessions[0].whole, "Available");
assert.equal(sessions[0].fractional, "Unavailable");
assert.equal(sessions[1].whole, "Not reported");
assert.equal(sessions[2].fractional, "Not reported");
assert.equal(tradingSessions(null)[0].whole, "Not reported");
const flat = tradingSessions({
  fractionalTradability: "position_closing_only",
  extendedHoursFractionalTradability: false,
  allDayTradability: "tradable",
});
assert.equal(flat[0].fractional, "Sell only");
assert.equal(flat[1].fractional, "Unavailable");
assert.equal(flat[2].overall, "Available");
assert.equal(flat[2].whole, "Not reported");
console.log("Trading sessions: nested and documented schemas, restrictions and unknown values passed.");
