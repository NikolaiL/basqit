import { attachLitePile, settledPileLayout } from "./litePile";
import silhouettes from "./logo-bodies.json";
import Matter from "matter-js";

const { Bodies, Body, Composite, Engine, Query, Sleeping } = Matter;
type Rect = number[];

export function pileLogoSize(width: number, height: number, count: number) {
  const pileHeight = Math.min(120, height * 0.35);
  return 1.3225 * Math.min(width <= 650 ? 24 : 32, Math.sqrt((width * pileHeight) / (Math.max(1, count) * 1.8)));
}

export function createPileEngine() {
  return Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 8 });
}

export function pileWalls(width: number, height: number, radius: number) {
  const wall = { isStatic: true, friction: 0.8 };
  const walls = [
    Bodies.rectangle(width / 2, height + 25, width + 100, 50, wall),
    Bodies.rectangle(-25, height / 2 - 500, 50, height + 2000, wall),
    Bodies.rectangle(width + 25, height / 2 - 500, 50, height + 2000, wall),
  ];
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (!r) return walls;
  // Small convex strips follow the bottom corner arcs, with chords on the safe side.
  for (const right of [false, true]) {
    for (let i = 0; i < 16; i++) {
      const a = ((i / 16) * Math.PI) / 2;
      const b = (((i + 1) / 16) * Math.PI) / 2;
      const x = (angle: number) => r - r * Math.cos(angle);
      const y = (angle: number) => height - r + r * Math.sin(angle);
      const vertices = [
        { x: -25, y: y(a) },
        { x: x(a), y: y(a) },
        { x: x(b), y: y(b) },
        { x: -25, y: y(b) },
      ].map(point => ({ x: right ? width - point.x : point.x, y: point.y }));
      const center = Matter.Vertices.centre(vertices);
      walls.push(Bodies.fromVertices(center.x, center.y, [vertices], wall));
    }
  }
  return walls;
}

export function stepPile(engine: Matter.Engine, lite = false) {
  // Thin alpha-mask parts need substeps to avoid tunnelling through each other.
  const bodies = Composite.allBodies(engine.world);
  const speed = bodies.reduce(
    (max, body) =>
      body.isStatic || body.isSleeping
        ? max
        : Math.max(max, body.speed + Math.abs(body.angularSpeed) * Math.sqrt(body.area)),
    0,
  );
  const steps = lite ? 4 : Math.min(16, Math.max(4, Math.ceil(speed * 4)));
  for (let i = 0; i < steps; i++) Engine.update(engine, 1000 / (60 * steps));
}

export function spawnLogo(
  body: Matter.Body,
  width: number,
  size: number,
  others: Matter.Body[],
  random = Math.random,
  top = 0,
) {
  Body.setAngle(body, (random() - 0.5) * Math.PI * 2);
  for (let attempt = 0; attempt < 32; attempt++) {
    Body.setPosition(body, {
      x: size + random() * Math.max(0, width - size * 2),
      y: top - size * (2 + random() * Math.max(6, ((others.length * size) / width) * 4)),
    });
    if (!Query.collides(body, others).length) return;
  }
  Body.setPosition(body, {
    x: body.position.x,
    y: Math.min(top - size, ...others.map(other => other.bounds.min.y)) - size * 2,
  });
}

export function shrinkLogo(entry: ReturnType<typeof logoBody>, time: number) {
  const progress = Math.min(1, Math.max(0, (time - entry.returnAt) / 600));
  const scale = 1 + (entry.returnScale - 1) * (1 - progress) ** 3;
  if (scale !== entry.scale) {
    Body.scale(entry.body, scale / entry.scale, scale / entry.scale);
    entry.scale = scale;
  }
}

export function pickLogo(bodies: Matter.Body[], point: Matter.Vector, touch: boolean) {
  const exact = Query.point(bodies, point).at(-1);
  if (exact || !touch) return exact;
  let nearest: Matter.Body | undefined;
  let distance = 22;
  for (const body of [...bodies].reverse()) {
    for (const part of body.parts.length > 1 ? body.parts.slice(1) : body.parts) {
      for (let i = 0; i < part.vertices.length; i++) {
        const a = part.vertices[i],
          b = part.vertices[(i + 1) % part.vertices.length];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
        if (d < distance) {
          distance = d;
          nearest = body;
        }
      }
    }
  }
  return nearest;
}

function logoBounds(symbol: string) {
  const shape = (silhouettes as Record<string, Rect[]>)[symbol];
  if (!shape?.length) throw new Error(`Missing silhouette: ${symbol}`);
  const left = Math.min(...shape.map(([x]) => x));
  const top = Math.min(...shape.map(([, y]) => y));
  const extent = Math.max(
    Math.max(...shape.map(([x, , w]) => x + w)) - left,
    Math.max(...shape.map(([, y, , h]) => y + h)) - top,
  );
  return { shape, left, top, extent };
}

export function logoBody(symbol: string, size: number) {
  const { shape, left, top, extent } = logoBounds(symbol);
  // Normalize visible bounds, not the PNG canvas, for both rendering and collisions.
  const imageSize = size / extent;
  const parts = shape.map(([x, y, w, h]) =>
    Bodies.rectangle((x - left + w / 2) * imageSize, (y - top + h / 2) * imageSize, w * imageSize, h * imageSize),
  );
  const body = Body.create({
    parts,
    friction: 0.6,
    frictionStatic: 0.9,
    restitution: 0.12,
    frictionAir: 0.025,
    sleepThreshold: 45,
  });
  return {
    body,
    scale: 1,
    returnScale: 1,
    returnAt: 0,
    drawnTransform: "",
    origin: { ...body.position },
    imageTransform: `translate(${-left * imageSize}px, ${-top * imageSize}px) scale(${1 / extent})`,
  };
}

/** A single convex collider replaces the many alpha-mask strips on slow devices. */
export function simplifyLogo(body: Matter.Body) {
  const center = { ...body.position };
  const hull = Matter.Vertices.hull(
    body.parts
      .slice(1)
      .flatMap(part => part.vertices)
      .map((vertex, index) => ({ ...vertex, index, body, isInternal: false })),
  );
  if (hull.length < 3) return;
  const centroid = Matter.Vertices.centre(hull);
  const part = Bodies.fromVertices(centroid.x, centroid.y, [hull]);
  Body.setParts(body, [body, part], false);
  Body.setCentre(body, center);
}

export function needsLitePile(samples: { frame: number; work: number }[]) {
  // Require sustained slow frames AND expensive simulation, not loading or a 30 Hz screen.
  if (samples.length < 24) return false;
  const slow = samples.filter(sample => sample.frame > 50 && sample.work > 25);
  return slow.length >= samples.length * 0.8;
}

/** Restore the offline simulation; startup needs no collision steps. */
export function placeSettledLogo(symbol: string, width: number, height: number) {
  const layout = settledPileLayout(width);
  const scale = width / layout.width;
  const placement = layout.coins[symbol as keyof typeof layout.coins];
  const entry = logoBody(symbol, layout.size * scale);
  Body.setPosition(entry.body, { x: placement.x * scale, y: height + placement.y * scale });
  Body.setAngle(entry.body, placement.angle);
  Sleeping.set(entry.body, true);
  return entry;
}

export function attachPilePhysics(scene: HTMLElement, onDrop: (coin: HTMLElement) => void) {
  let staticCleanup: (() => void) | undefined;
  const engine = createPileEngine();
  const container = scene.closest<HTMLElement>(".bq-discover-playground");
  const coins = [...scene.querySelectorAll<HTMLElement>(".bq-discover-coin")];
  const entries = new Map<HTMLElement, ReturnType<typeof logoBody>>();
  const matchedPositions = new Map<HTMLElement, { x: number; y: number; size: number }>();
  let initializing = true;
  let firstEntrance = true;
  const entrance = new Map<HTMLElement, Animation>();
  let sampleUntil = 0;
  let measureAfter = performance.now() + 750;
  const samples: { frame: number; work: number }[] = [];
  scene.dataset.physicsQuality = "full";
  function enableLite() {
    cleanup();
    staticCleanup = attachLitePile(scene);
  }
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0,
    height = 0,
    headroom = 0,
    size = 32,
    frame = 0,
    settleSteps = 0,
    last = 0,
    accumulated = 0,
    visible = true,
    disposed = false;
  let drag:
    | { coin: HTMLElement; entry: ReturnType<typeof logoBody>; id: number; x: number; y: number; moved: boolean }
    | undefined;
  function captureMatches() {
    const sceneBounds = scene.getBoundingClientRect();
    for (const coin of coins) {
      if (!coin.classList.contains("is-match")) continue;
      const img = coin.querySelector("img");
      if (!img) continue;
      const rect = img.getBoundingClientRect();
      const padding = (parseFloat(getComputedStyle(img).paddingLeft) * rect.width) / img.offsetWidth;
      const canvas = Math.min(rect.width, rect.height) - padding * 2;
      const imageBounds = logoBounds(coin.dataset.symbol!);
      matchedPositions.set(coin, {
        x: rect.left - sceneBounds.left + padding + imageBounds.left * canvas,
        y: rect.top - sceneBounds.top + padding + imageBounds.top * canvas,
        size: canvas * imageBounds.extent,
      });
    }
  }

  function draw() {
    for (const [coin, entry] of entries) {
      const { body, origin, scale } = entry;
      const transform = `translate3d(${body.position.x - origin.x}px, ${body.position.y - origin.y}px, 0) rotate(${body.angle}rad) scale(${scale})`;
      if (entry.drawnTransform === transform) continue;
      entry.drawnTransform = transform;
      coin.dataset.physics = "active";
      coin.style.transform = transform;
    }
  }
  const typing = () =>
    matchMedia("(pointer: coarse)").matches &&
    document.activeElement?.tagName === "INPUT" &&
    !!container?.contains(document.activeElement);
  function inputFocus() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    queueMicrotask(() => {
      if (!typing()) {
        resize();
        wake();
      }
    });
  }
  function tick(time: number) {
    frame = 0;
    if (disposed || !visible || document.hidden || typing()) return;
    const started = performance.now();
    const frameTime = last ? time - last : 0;
    accumulated += motion.matches ? 200 : last ? Math.min(50, time - last) : 1000 / 60;
    const steps = Math.floor(accumulated / (1000 / 60));
    accumulated -= steps * (1000 / 60);
    last = time;
    for (let i = 0; i < steps; i++) {
      entries.forEach(entry => shrinkLogo(entry, engine.timing.timestamp));
      if ([...entries.values()].some(({ body, scale }) => scale !== 1 || (!body.isSleeping && !body.isStatic)))
        stepPile(engine);
    }
    if (time < sampleUntil) captureMatches();
    if (motion.matches && (settleSteps += steps) >= 600) entries.forEach(({ body }) => Sleeping.set(body, true));
    if (!motion.matches || [...entries.values()].every(({ body }) => body.isSleeping || body.isStatic)) draw();
    if (!motion.matches && steps && !drag && last && time >= measureAfter && frameTime > 0) {
      samples.push({ frame: frameTime, work: performance.now() - started });
      if (samples.length > 24) samples.shift();
      if (needsLitePile(samples)) {
        enableLite();
        return;
      }
    }
    if (
      time < sampleUntil ||
      [...entries.values()].some(({ body, scale }) => scale !== 1 || (!body.isSleeping && !body.isStatic))
    )
      wake();
    else {
      last = 0;
      samples.length = 0;
    }
  }
  function wake() {
    if (!frame && visible && !document.hidden && !disposed && !typing()) frame = requestAnimationFrame(tick);
  }
  function resetCoin(coin: HTMLElement) {
    for (const property of ["left", "top", "transform", "transform-origin", "--physics-size", "--logo-transform"])
      coin.style.removeProperty(property);
    entrance.get(coin)?.cancel();
    entrance.delete(coin);
    delete coin.dataset.physics;
  }
  function sync() {
    const selected = new Set(coins.filter(coin => !coin.classList.contains("is-match")));
    for (const [coin, entry] of entries) {
      if (!selected.has(coin)) {
        if (drag?.coin === coin) release();
        Composite.remove(engine.world, entry.body);
        entries.delete(coin);
        resetCoin(coin);
        entries.forEach(({ body }) => Sleeping.set(body, false));
      }
    }
    sampleUntil = selected.size < coins.length ? performance.now() + 1000 : 0;
    for (const coin of selected) {
      if (entries.has(coin)) continue;
      const entry = initializing
        ? placeSettledLogo(coin.dataset.symbol!, width, height)
        : logoBody(coin.dataset.symbol!, size);
      const previous = matchedPositions.get(coin);
      if (previous && !initializing) {
        const scale = motion.matches ? 1 : previous.size / size;
        entry.returnScale = entry.scale = scale;
        entry.returnAt = engine.timing.timestamp;
        Body.scale(entry.body, scale, scale);
        Body.setPosition(entry.body, {
          x: previous.x + entry.origin.x * scale,
          y: previous.y + entry.origin.y * scale,
        });
        matchedPositions.delete(coin);
      } else if (!initializing) {
        spawnLogo(
          entry.body,
          width,
          size,
          [...entries.values()].map(({ body }) => body),
          Math.random,
          -headroom,
        );
      }
      entries.set(coin, entry);
      Composite.add(engine.world, entry.body);
      coin.dataset.physics = "active";
      coin.style.left = "0px";
      coin.style.top = "0px";
      coin.style.transformOrigin = `${entry.origin.x}px ${entry.origin.y}px`;
      coin.style.setProperty("--physics-size", `${size}px`);
      coin.style.setProperty("--logo-transform", entry.imageTransform);
      // Reduced-motion users see the settled layout, never the initial fall.
      if (motion.matches && !initializing) coin.dataset.physics = "settling";
    }
    if (!motion.matches || initializing) draw();
    if (initializing && firstEntrance && !motion.matches) {
      for (const [coin] of entries) {
        const transform = coin.style.transform;
        const animation = coin.animate(
          [
            { transform: `translateY(-32px) ${transform}`, opacity: 0 },
            { transform, opacity: 1 },
          ],
          { duration: 450, easing: "ease-out" },
        );
        entrance.set(coin, animation);
        animation.onfinish = () => entrance.delete(coin);
      }
    }
    initializing = false;
    firstEntrance = false;
    captureMatches();
    settleSteps = 0;
    wake();
  }
  function resize() {
    if (typing()) return;
    const nextWidth = scene.clientWidth,
      nextHeight = scene.clientHeight;
    const nextHeadroom = container
      ? scene.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop
      : 0;
    if (nextWidth === width && nextHeight === height && nextHeadroom === headroom) return;
    measureAfter = performance.now() + 750;
    samples.length = 0;
    release();
    width = nextWidth;
    height = nextHeight;
    headroom = nextHeadroom;
    scene.style.setProperty("--physics-headroom", `${headroom}px`);
    const layout = settledPileLayout(width);
    size = layout.size * (width / layout.width);
    initializing = true;
    Composite.clear(engine.world, false);
    entries.forEach((_entry, coin) => resetCoin(coin));
    entries.clear();
    const radius = container ? parseFloat(getComputedStyle(container).borderBottomLeftRadius) || 0 : 0;
    Composite.add(engine.world, pileWalls(width, height, radius));
    sync();
  }
  function down(event: PointerEvent) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      drag ||
      (event.target as Element).closest(".is-match, .bq-discover-actions")
    )
      return;
    const bounds = scene.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const hit = pickLogo(
      [...entries.values()].map(entry => entry.body),
      point,
      event.pointerType === "touch",
    );
    if (!hit) return;
    const [coin, entry] = [...entries].find(([, entry]) => entry.body === hit)!;
    entrance.forEach(animation => animation.cancel());
    entrance.clear();
    drag = { coin, entry, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    scene.setPointerCapture(event.pointerId);
    Body.setStatic(hit, true);
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < (event.pointerType === "touch" ? 8 : 5)) return;
    if (!drag.moved) entries.forEach(({ body }) => Sleeping.set(body, false));
    drag.moved = true;
    const body = drag.entry.body;
    Body.translate(body, { x: dx, y: dy });
    Body.translate(body, {
      x: Math.max(0, -body.bounds.min.x) - Math.max(0, body.bounds.max.x - width),
      y: Math.max(0, -headroom - body.bounds.min.y) - Math.max(0, body.bounds.max.y - height),
    });
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
    wake();
  }
  function release(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const current = drag;
    drag = undefined;
    if (scene.hasPointerCapture(current.id)) scene.releasePointerCapture(current.id);
    Body.setStatic(current.entry.body, false);
    Sleeping.set(current.entry.body, false);
    settleSteps = 0;
    if (current.moved) onDrop(current.coin);
    else if (event?.type === "pointerup") current.coin.click();
    wake();
  }
  function click(event: MouseEvent) {
    // Pointer picking uses the alpha body; only synthetic/keyboard clicks reach React.
    if (event.detail && (event.target as Element).closest(".bq-discover-coin:not(.is-match)")) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function preventNativeDrag(event: DragEvent) {
    if ((event.target as Element).closest(".bq-discover-coin:not(.is-match)")) event.preventDefault();
  }
  function visibility() {
    measureAfter = performance.now() + 750;
    last = 0;
    samples.length = 0;
    wake();
  }
  const observer = new MutationObserver(sync);
  observer.observe(scene, { subtree: true, attributes: true, attributeFilter: ["class"] });
  const boundsObserver = new ResizeObserver(resize);
  boundsObserver.observe(scene);
  if (container) boundsObserver.observe(container);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visibility();
  });
  intersection.observe(scene);
  scene.addEventListener("click", click, true);
  scene.addEventListener("dragstart", preventNativeDrag);
  scene.addEventListener("pointerdown", down);
  scene.addEventListener("pointermove", move);
  scene.addEventListener("pointerup", release);
  scene.addEventListener("pointercancel", release);
  scene.addEventListener("lostpointercapture", release);
  document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", visibility);
  container?.addEventListener("focusin", inputFocus);
  container?.addEventListener("focusout", inputFocus);
  resize();
  function cleanup() {
    disposed = true;
    container?.removeEventListener("focusin", inputFocus);
    container?.removeEventListener("focusout", inputFocus);
    release();
    cancelAnimationFrame(frame);
    observer.disconnect();
    boundsObserver.disconnect();
    scene.style.removeProperty("--physics-headroom");
    delete scene.dataset.physicsQuality;
    intersection.disconnect();
    scene.removeEventListener("click", click, true);
    scene.removeEventListener("dragstart", preventNativeDrag);
    scene.removeEventListener("pointerdown", down);
    scene.removeEventListener("pointermove", move);
    scene.removeEventListener("pointerup", release);
    scene.removeEventListener("pointercancel", release);
    scene.removeEventListener("lostpointercapture", release);
    document.removeEventListener("visibilitychange", visibility);
    motion.removeEventListener("change", visibility);
    coins.forEach(resetCoin);
    Composite.clear(engine.world, false);
    Engine.clear(engine);
  }
  return () => {
    cleanup();
    staticCleanup?.();
  };
}
