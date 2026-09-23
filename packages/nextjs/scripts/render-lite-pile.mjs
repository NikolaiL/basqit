// Precompute collision-safe mobile layouts; no physics runs on the phone.
import Matter from "matter-js";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const shapes = JSON.parse(readFileSync("services/discover/logo-bodies.json"));
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("services/discover/pilePhysics.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, require: name => (name === "./logo-bodies.json" ? shapes : name === "./litePile" ? {} : require(name)) },
);
function maxOverlap(bodies) {
  let max = 0;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      if (!Matter.Bounds.overlaps(bodies[i].bounds, bodies[j].bounds)) continue;
      for (const a of bodies[i].parts.slice(1))
        for (const b of bodies[j].parts.slice(1)) max = Math.max(max, Matter.Collision.collides(a, b)?.depth ?? 0);
    }
  return max;
}

// Several settled piles per width; the page picks one at random, so reloads differ at no runtime cost.
const VARIANTS = 5;
const round = (value, digits) => Number(value.toFixed(digits));
const layouts = [];
for (const width of [400, 600, 900, 1400]) {
  const height = 400,
    size = exports.pileLogoSize(width, 350, 195);
  const symbols = Object.keys(shapes);
  const base = symbols.map(symbol => exports.logoBody(symbol, size));
  const variants = [];
  for (let attempt = 0; variants.length < VARIANTS; attempt++) {
    if (attempt >= VARIANTS * 3) throw Error(`Too few overlap-free piles at ${width}px`);
    const variant = variants.length ? attempt : 0;
    const engine = exports.createPileEngine();
    // Offline, so solve more precisely than the live page does.
    engine.positionIterations = 12;
    engine.velocityIterations = 8;
    Matter.Composite.add(engine.world, exports.pileWalls(width, height, 64));
    let seed = 789 + variant * 1000003;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    // Shuffle the spawn order too, so the same logos do not always end up on top.
    const order = symbols.map((_, i) => i);
    for (let i = order.length - 1; variant && i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const bodies = symbols.map(symbol => exports.logoBody(symbol, size).body);
    const placed = [];
    for (const i of order) {
      exports.spawnLogo(bodies[i], width, size, placed, random);
      placed.push(bodies[i]);
    }
    Matter.Composite.add(engine.world, bodies);
    for (let i = 0; i < 1200 && !bodies.every(b => b.isSleeping); i++) exports.stepPile(engine);
    if (!bodies.every(b => b.isSleeping)) throw Error("Pile did not settle");
    if (maxOverlap(bodies) > 0.3) continue;
    variants.push(bodies.flatMap(b => [round(b.position.x, 2), round(b.position.y - height, 2), round(b.angle, 4)]));
  }
  layouts.push({
    width,
    size,
    symbols,
    origins: base.flatMap(e => [round(e.origin.x, 3), round(e.origin.y, 3)]),
    images: base.map(e => e.imageTransform),
    variants,
  });
}
writeFileSync("services/discover/lite-pile-layouts.json", JSON.stringify(layouts));
console.log(`Generated ${VARIANTS} settled layouts for each of ${layouts.length} widths with all 195 logos.`);
