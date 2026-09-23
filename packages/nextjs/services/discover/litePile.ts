import layouts from "./lite-pile-layouts.json";

type Placement = { x: number; y: number; angle: number; ox: number; oy: number; image: string };
export type SettledLayout = { width: number; size: number; coins: Record<string, Placement> };

// One pile per page load; every width uses the same variant index so resizing keeps the look.
const pick = Math.random();
const cache = new Map<string, SettledLayout>();

export function settledPileLayout(width: number, variant?: number): SettledLayout {
  const source = layouts.find(layout => layout.width >= width) ?? layouts[layouts.length - 1];
  const index = variant ?? Math.floor(pick * source.variants.length);
  const key = `${source.width}:${index}`;
  let layout = cache.get(key);
  if (!layout) {
    const positions = source.variants[index];
    layout = {
      width: source.width,
      size: source.size,
      coins: Object.fromEntries(
        source.symbols.map((symbol, i) => [
          symbol,
          {
            x: positions[i * 3],
            y: positions[i * 3 + 1],
            angle: positions[i * 3 + 2],
            ox: source.origins[i * 2],
            oy: source.origins[i * 2 + 1],
            image: source.images[i],
          },
        ]),
      ),
    };
    cache.set(key, layout);
  }
  return layout;
}

/** Precomputed positions: no animation loop or collision engine on slow devices. */
export function attachLitePile(scene: HTMLElement) {
  const coins = [...scene.querySelectorAll<HTMLElement>(".bq-discover-coin")];
  const properties = ["left", "top", "transform", "transform-origin", "--physics-size", "--logo-transform"];
  function reset(coin: HTMLElement) {
    properties.forEach(property => coin.style.removeProperty(property));
    delete coin.dataset.physics;
  }
  function render() {
    const width = scene.clientWidth;
    const layout = settledPileLayout(width);
    const scale = width / layout.width;
    for (const coin of coins) {
      if (coin.classList.contains("is-match")) {
        reset(coin);
        continue;
      }
      const placement = layout.coins[coin.dataset.symbol!];
      if (!placement) continue;
      coin.style.left = "0px";
      coin.style.top = "0px";
      coin.style.transformOrigin = `${placement.ox * scale}px ${placement.oy * scale}px`;
      coin.style.transform = `translate(${(placement.x - placement.ox) * scale}px, ${scene.clientHeight + (placement.y - placement.oy) * scale}px) rotate(${placement.angle}rad)`;
      coin.style.setProperty("--physics-size", `${layout.size * scale}px`);
      // Image offsets were computed at the source layout's size.
      coin.style.setProperty(
        "--logo-transform",
        placement.image.replace(/(-?[\d.]+)px/g, (_, value) => `${Number(value) * scale}px`),
      );
      coin.dataset.physics = "active";
    }
  }
  scene.dataset.physicsQuality = "static";
  render();
  const resize = new ResizeObserver(render);
  resize.observe(scene);
  const matches = new MutationObserver(render);
  matches.observe(scene, { subtree: true, attributes: true, attributeFilter: ["class"] });
  return () => {
    resize.disconnect();
    matches.disconnect();
    coins.forEach(reset);
    delete scene.dataset.physicsQuality;
  };
}
