import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const layouts = JSON.parse(readFileSync(new URL("./lite-pile-layouts.json", import.meta.url)));
const exports = {},
  observers = [];
class Observer {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("./litePile.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText,
  { exports, require: () => layouts, ResizeObserver: Observer, MutationObserver: Observer },
);
const coins = Object.keys(layouts[0].coins).map(symbol => ({
  dataset: { symbol },
  matched: false,
  classList: {
    contains() {
      return this.coin.matched;
    },
  },
  style: {
    setProperty(k, v) {
      this[k] = v;
    },
    removeProperty(k) {
      delete this[k];
    },
  },
}));
coins.forEach(coin => (coin.classList.coin = coin));
const scene = { clientWidth: 320, clientHeight: 350, dataset: {}, querySelectorAll: () => coins };
const cleanup = exports.attachLitePile(scene);
assert.equal(coins.length, 195);
assert.equal(scene.dataset.physicsQuality, "static");
for (const width of [280, 320, 390, 600, 900, 1400]) {
  scene.clientWidth = width;
  observers[0].callback();
  for (const coin of coins) {
    assert.equal(coin.dataset.physics, "active");
    assert.ok(!/NaN|undefined/.test(coin.style.transform));
  }
}
coins[0].matched = true;
observers[1].callback();
assert.equal(coins[0].style.transform, undefined, "selected logo uses result layout");
coins[0].matched = false;
observers[1].callback();
assert.equal(coins[0].dataset.physics, "active", "cleared selection returns to static pile");
cleanup();
assert.ok(observers.every(o => o.disconnected));
assert.ok(coins.every(c => !c.dataset.physics));
console.log(
  "Static pile: all 195 logos, responsive placement, selection and cleanup; no animation or physics APIs available.",
);
