import Matter from "matter-js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const shapes = JSON.parse(readFileSync(new URL("./logo-bodies.json", import.meta.url)));
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("./pilePhysics.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, require: name => (name === "./logo-bodies.json" ? shapes : name === "./litePile" ? {} : require(name)) },
);
const { Body, Composite, Query } = Matter;
const {
  logoBody,
  createPileEngine,
  stepPile: fullStep,
  pileLogoSize,
  pileWalls,
  spawnLogo,
  shrinkLogo,
  pickLogo,
  simplifyLogo,
  needsLitePile,
} = exports;
const lite = process.env.PILE_TEST_LITE === "1";
let activeLite = lite;
const stepPile = engine => fullStep(engine, activeLite);
assert.equal(needsLitePile(Array(24).fill({ frame: 16, work: 3 })), false);
assert.equal(needsLitePile(Array(24).fill({ frame: 34, work: 15 })), false, "30 Hz devices retain animation");
assert.equal(
  needsLitePile(Array(24).fill({ frame: 100, work: 3 })),
  false,
  "external delays do not indicate expensive physics",
);
assert.equal(needsLitePile([{ frame: 300, work: 100 }, ...Array(23).fill({ frame: 16, work: 3 })]), false);
assert.equal(needsLitePile(Array(2).fill({ frame: 100, work: 80 })), false, "startup spikes cannot select static mode");
assert.equal(needsLitePile(Array(23).fill({ frame: 80, work: 45 })), false);
assert.equal(
  needsLitePile(Array(24).fill({ frame: 80, work: 45 })),
  true,
  "sustained expensive frames select static mode",
);
// Slow bodies use fewer updates; fast bodies retain the fine collision steps.
const timingEngine = createPileEngine();
const timingBody = logoBody("AAPL", 24).body;
Composite.add(timingEngine.world, timingBody);
const update = Matter.Engine.update;
let updates = 0;
Matter.Engine.update = (...args) => {
  updates++;
  return update(...args);
};
try {
  stepPile(timingEngine);
  assert.equal(updates, lite ? 4 : 4);
  assert.ok(Math.abs(timingEngine.timing.timestamp - 1000 / 60) < 1e-6);
  Body.setVelocity(timingBody, { x: 10, y: 0 });
  updates = 0;
  stepPile(timingEngine);
  assert.equal(updates, lite ? 4 : 16, "fast logos retain collision accuracy");
} finally {
  Matter.Engine.update = update;
}
assert.equal(Object.keys(shapes).length, 195);
for (const symbol of Object.keys(shapes)) {
  const { body, origin } = logoBody(symbol, 32);
  assert.ok(body.area > 0 && Number.isFinite(body.mass));
  assert.ok(
    Math.abs(Math.max(body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y) - 32) < 1e-6,
    "visible logo bounds normalized",
  );
  assert.ok(origin.x >= 0 && origin.x <= 32 && origin.y >= 0 && origin.y <= 32);
}
const google = logoBody("GOOGL", 64);
const falling = logoBody("AAPL", 24).body;
spawnLogo(falling, 320, 24, [], () => 0.5, -220);
assert.ok(falling.bounds.max.y < -220, "initial fall starts above the entire card, not the results scene");
const touchLogo = logoBody("AAPL", 16).body;
const near = { x: touchLogo.bounds.max.x + 10, y: touchLogo.position.y };
assert.equal(pickLogo([touchLogo], near, true), touchLogo, "finger can pick beside a small logo");
assert.equal(pickLogo([touchLogo], near, false), undefined, "mouse still requires a direct hit");
assert.equal(pickLogo([touchLogo], { ...near, x: touchLogo.bounds.max.x + 23 }, true), undefined);
const square = Matter.Bodies.rectangle(0, 0, 16, 16);
assert.equal(pickLogo([square], { x: 18, y: 0 }, true), square, "single-part logos have the same touch tolerance");
assert.equal(Query.point([google.body], { x: 0, y: 0 }).length, 0, "transparent corner is not a collider");
for (const [width, size, count] of [
  [320, pileLogoSize(320, 350, 195), 195],
  [900, pileLogoSize(900, 300, 195), 195],
]) {
  activeLite = lite;
  const engine = createPileEngine();
  const floorY = width <= 650 ? 350 : 300;
  Composite.add(engine.world, pileWalls(width, floorY, 32));
  let seed = Number(process.env.PILE_TEST_SEED || 123456);
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const bodies = [];
  for (const symbol of Object.keys(shapes).slice(0, count)) {
    const { body } = logoBody(symbol, size);
    if (lite) {
      const position = { ...body.position };
      const bounds = JSON.stringify(body.bounds);
      simplifyLogo(body);
      assert.deepEqual({ ...body.position }, position, "simplification preserves visual anchor");
      assert.equal(JSON.stringify(body.bounds), bounds);
      assert.ok(body.parts.length <= 2, "one convex collider per logo");
    }
    spawnLogo(body, width, size, bodies, random);
    assert.equal(Query.collides(body, bodies).length, 0, "random spawn starts without overlap");
    bodies.push(body);
  }
  assert.equal(new Set(bodies.map(body => body.position.y)).size, count, "random starting heights, no rows");
  Composite.add(engine.world, bodies);
  function checkSettled() {
    for (let i = 0; i < 600; i++) {
      if (process.env.PILE_TEST_LITE === "switch" && i === 60 && !activeLite) {
        bodies.forEach(body => {
          simplifyLogo(body);
          Matter.Sleeping.set(body, false);
        });
        Matter.Engine.clear(engine);
        engine.world.isModified = true;
        activeLite = true;
      }
      stepPile(engine);
    }
    assert.ok(
      bodies.every(body => body.isSleeping),
      "entire pile must sleep, including bottom layer",
    );
    for (const body of bodies) {
      assert.ok(body.bounds.max.y < floorY + 0.3, "no floor penetration");
      assert.ok(body.bounds.min.x > -0.3 && body.bounds.max.x < width + 0.3, "no wall penetration");
      assert.ok(body.bounds.min.y >= floorY - 160, "larger logos fit in the bottom area");
      for (const part of body.parts.slice(1))
        for (const vertex of part.vertices) {
          if (vertex.y <= floorY - 32) continue;
          const cx = vertex.x < 32 ? 32 : vertex.x > width - 32 ? width - 32 : null;
          if (cx !== null)
            assert.ok(
              Math.hypot(vertex.x - cx, vertex.y - (floorY - 32)) <= 32.3,
              "logo stays inside rounded bottom corners",
            );
        }
    }
    // Check alpha parts, not the compound parent hull (which spans transparent gaps).
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        for (const a of bodies[i].parts.slice(1))
          for (const b of bodies[j].parts.slice(1)) {
            const collision = Matter.Collision.collides(a, b);
            assert.ok(
              !collision || collision.depth < 0.3,
              `visible parts penetrate: ${i}/${j} by ${collision?.depth}px`,
            );
          }
      }
    const positions = bodies.map(body => ({ ...body.position, angle: body.angle }));
    for (let i = 0; i < 120; i++) stepPile(engine);
    bodies.forEach((body, i) =>
      assert.deepEqual({ ...body.position, angle: body.angle }, positions[i], "settled logos must remain still"),
    );
  }
  checkSettled();
  const dragged = bodies[0];
  Body.setStatic(dragged, true);
  Body.setPosition(dragged, { x: width / 2, y: 40 });
  Body.setStatic(dragged, false);
  bodies.forEach(body => Matter.Sleeping.set(body, false));
  checkSettled();
  Composite.remove(engine.world, dragged);
  bodies.shift();
  bodies.forEach(body => Matter.Sleeping.set(body, false));
  checkSettled();
  console.log(`${count} bodies: no penetration or jitter after fall, drag/release and removal.`);
}

const returning = logoBody("AAPL", 12);
returning.returnScale = returning.scale = 4;
returning.returnAt = 100;
Body.scale(returning.body, 4, 4);
Body.setPosition(returning.body, { x: 180, y: 60 });
const origin = { ...returning.body.position };
shrinkLogo(returning, 100);
assert.equal(returning.scale, 4, "release starts at displayed size");
shrinkLogo(returning, 400);
assert.ok(returning.scale > 1 && returning.scale < 4, "shrinks during fall");
assert.deepEqual({ ...returning.body.position }, origin, "shrinking does not teleport the center");
shrinkLogo(returning, 700);
assert.equal(returning.scale, 1, "returns to original pile size");
assert.ok(
  Math.abs(
    Math.max(
      returning.body.bounds.max.x - returning.body.bounds.min.x,
      returning.body.bounds.max.y - returning.body.bounds.min.y,
    ) - 12,
  ) < 1e-6,
);
console.log("Random non-overlapping spawns and smooth return scaling passed.");
