import { attachPileDrag } from "./pileDrag.ts";
import assert from "node:assert/strict";

const listeners = new Map();
const scene = {
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: name => listeners.delete(name),
  getBoundingClientRect: () => ({ left: 0, right: 600, top: 0, bottom: 400 }),
};
const classes = new Set();
let captured,
  animation,
  reduced = false;
const coin = {
  style: {
    transform: "rotate(17deg)",
    border: "1px solid",
    removeProperty(name) {
      delete this[name];
    },
  },
  classList: {
    contains: name => classes.has(name),
    add: name => classes.add(name),
    remove: (...names) => names.forEach(name => classes.delete(name)),
  },
  closest: () => coin,
  getBoundingClientRect: () => ({ left: 100, right: 160, top: 250, bottom: 310 }),
  setPointerCapture: id => {
    captured = id;
  },
  hasPointerCapture: id => captured === id,
  releasePointerCapture: () => {
    captured = undefined;
  },
  animate: (frames, options) =>
    (animation = {
      frames,
      options,
      cancel() {
        this.canceled = true;
      },
    }),
};
const previous = { window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
globalThis.window = { matchMedia: () => ({ matches: reduced }) };
globalThis.getComputedStyle = () => ({ translate: coin.style.translate ?? "none" });
const emit = (name, overrides = {}) => {
  const event = {
    target: coin,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    clientX: 130,
    clientY: 280,
    detail: 1,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...overrides,
  };
  listeners.get(name)(event);
  return event;
};
try {
  let cleanup = attachPileDrag(scene);
  emit("pointerdown");
  emit("pointerup");
  assert.equal(emit("click").stopped, undefined, "a tap still opens details");
  emit("pointerdown");
  emit("pointermove", { clientX: 180, clientY: 130 });
  assert.equal(coin.style.translate, "50px -150px");
  assert.equal(coin.style.transform, "rotate(17deg)");
  assert.equal(coin.style.border, "1px solid");
  assert.ok(classes.has("is-dragging"));
  emit("pointerup");
  assert.equal(coin.style.translate, "50px 0px", "lands at the release x position");
  assert.equal(animation.frames[0].translate, "50px -150px");
  assert.equal(animation.frames[1].translate, "50px 0px");
  assert.ok(animation.options.duration > 0);
  assert.ok(emit("click").stopped, "drag release must not open a popup");
  animation.onfinish();
  assert.equal(classes.has("is-falling"), false);
  assert.equal(emit("click", { detail: 0 }).stopped, undefined, "keyboard activation remains available");
  cleanup();
  assert.equal(coin.style.translate, undefined, "theme changes restore original positions");
  cleanup = attachPileDrag(scene);
  classes.add("is-match");
  emit("pointerdown");
  emit("pointermove", { clientY: 0 });
  assert.equal(coin.style.translate, undefined, "matched tokens do not drag");
  classes.delete("is-match");
  emit("pointerdown");
  emit("pointermove", { clientX: -1000, clientY: -1000 });
  assert.equal(coin.style.translate, "-100px -250px", "keep coin inside the scene");
  emit("pointercancel");
  assert.ok(classes.has("is-falling"), "cancel releases the coin too");
  cleanup();
  assert.ok(animation.canceled);
  reduced = true;
  animation = undefined;
  cleanup = attachPileDrag(scene);
  emit("pointerdown");
  emit("pointermove", { clientY: 100 });
  emit("pointerup");
  assert.equal(animation, undefined, "respect reduced motion");
  assert.equal(coin.style.translate, "0px 0px");
  assert.ok(emit("dragstart").prevented, "disable native image ghost dragging");
  cleanup();
  assert.equal(listeners.size, 0);
  console.log("Pile drag: border/rotation, fall, bounds, clicks, cancellation, cleanup and reduced motion passed");
} finally {
  globalThis.window = previous.window;
  globalThis.getComputedStyle = previous.getComputedStyle;
}
