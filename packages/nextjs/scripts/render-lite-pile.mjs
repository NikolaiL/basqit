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
  for (let variant = 0; variant < VARIANTS; variant++) {
    const engine = exports.createPileEngine();
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
