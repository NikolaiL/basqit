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
const layouts = [];
for (const width of [400, 600, 900, 1400]) {
  const height = 400,
    size = exports.pileLogoSize(width, 350, 195),
    engine = exports.createPileEngine();
  Matter.Composite.add(engine.world, exports.pileWalls(width, height, 64));
  let seed = 789;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const entries = Object.keys(shapes).map(symbol => ({ symbol, ...exports.logoBody(symbol, size) }));
  const bodies = [];
  for (const entry of entries) {
    exports.spawnLogo(entry.body, width, size, bodies, random);
    bodies.push(entry.body);
  }
  Matter.Composite.add(engine.world, bodies);
  for (let i = 0; i < 1200 && !bodies.every(b => b.isSleeping); i++) exports.stepPile(engine);
  if (!bodies.every(b => b.isSleeping)) throw Error("Pile did not settle");
  layouts.push({
    width,
    size,
    coins: Object.fromEntries(
      entries.map(e => [
        e.symbol,
        {
          x: e.body.position.x,
          y: e.body.position.y - height,
          angle: e.body.angle,
          ox: e.origin.x,
          oy: e.origin.y,
          image: e.imageTransform,
        },
      ]),
    ),
  });
}
writeFileSync("services/discover/lite-pile-layouts.json", JSON.stringify(layouts));
console.log("Generated four settled layouts with all 195 logos.");
