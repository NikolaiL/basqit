import { pilePosition } from "./pileLayout.ts";
import assert from "node:assert/strict";

const points = Array.from({ length: 195 }, (_, i) => pilePosition(`TOKEN${i}`, i, 195));
assert.deepEqual(pilePosition("AAPL", 1, 195), pilePosition("AAPL", 1, 195));
assert.equal(new Set(points.map(p => `${p.x}:${p.y}`)).size, points.length);
for (const p of points) {
  assert.ok(p.x >= 5 && p.x <= 95);
  assert.ok(p.y >= 187 && p.y <= 273);
  assert.ok(p.mobileY >= 255 && p.mobileY <= 309);
  assert.ok(Math.abs(p.tilt) <= 45);
}
assert.ok(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > 60);
console.log("Pile layout: stable, distinct positions, varied height and bounded mobile/desktop scatter passed.");

const floor = points.filter(p => p.grounded);
assert.equal(floor.length, 12);
assert.equal(points.filter(p => p.mobileGrounded).length, 6);
assert.ok(floor[0].x < 12 && floor.at(-1).x > 88);
for (let i = 1; i < floor.length; i++) assert.ok(floor[i].x - floor[i - 1].x < 14);
console.log("Sparse supporting coins span the floor without forming a dense strip.");
