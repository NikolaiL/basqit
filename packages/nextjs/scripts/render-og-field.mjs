// Run from packages/nextjs after changing logos or pile physics.
import Matter from "matter-js";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
const logos = JSON.parse(await readFile("services/discover/logos.json", "utf8"));
const shapes = JSON.parse(await readFile("services/discover/logo-bodies.json", "utf8"));
const exports = {};
vm.runInNewContext(
  ts.transpileModule(await readFile("services/discover/pilePhysics.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, require: name => (name === "./logo-bodies.json" ? shapes : require(name)) },
);
const { logoBody, createPileEngine, stepPile, pileLogoSize, pileWalls, spawnLogo } = exports;
const width = 1200,
  height = 198,
  radius = 32;
const size = pileLogoSize(width, 300, Object.keys(logos).length);
const sources = await Promise.all(
  Object.entries(logos).map(async ([symbol, file]) => {
    const data = await readFile(path.join("public", file));
    return { symbol, src: `data:image/${file.endsWith(".svg") ? "svg+xml" : "png"};base64,${data.toString("base64")}` };
  }),
);
await mkdir("public/og", { recursive: true });
for (let variant = 0; variant < 4; variant++) {
  let seed = 123456 + variant * 7919;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const engine = createPileEngine();
  Matter.Composite.add(engine.world, pileWalls(width, height, radius));
  const entries = [];
  for (const source of sources) {
    const entry = { ...source, ...logoBody(source.symbol, size) };
    spawnLogo(
      entry.body,
      width,
      size,
      entries.map(item => item.body),
      random,
    );
    entries.push(entry);
  }
  Matter.Composite.add(
    engine.world,
    entries.map(entry => entry.body),
  );
  for (let frame = 0; frame < 900 && !entries.every(entry => entry.body.isSleeping); frame++) stepPile(engine);
  assert.ok(
    entries.every(entry => entry.body.isSleeping),
    `Variant ${variant} must settle`,
  );
  for (const { body } of entries) {
    for (const part of body.parts.slice(1))
      for (const v of part.vertices) {
        assert.ok(v.x >= -0.3 && v.x <= width + 0.3 && v.y >= 0 && v.y <= height + 0.3);
        const cx = v.x < radius ? radius : v.x > width - radius ? width - radius : null;
        if (cx !== null && v.y > height - radius)
          assert.ok(Math.hypot(v.x - cx, v.y - (height - radius)) <= radius + 0.3);
      }
  }
  const images = entries
    .map(
      ({ src, body, origin, imageTransform }) =>
        `<g transform="translate(${body.position.x} ${body.position.y}) rotate(${(body.angle * 180) / Math.PI}) translate(${-origin.x} ${-origin.y})"><image href="${src}" width="${size}" height="${size}" transform="${imageTransform.replaceAll("px", "")}"/></g>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${images}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`public/og/stock-field-${variant}.png`);
  Matter.Engine.clear(engine);
  console.log(`Rendered settled variant ${variant}: ${entries.length} transparent logos`);
}
