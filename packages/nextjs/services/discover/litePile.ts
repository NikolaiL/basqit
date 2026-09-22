import layouts from "./lite-pile-layouts.json";

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
    const layout = layouts.find(layout => layout.width >= width) ?? layouts[layouts.length - 1];
    const scale = width / layout.width;
    for (const coin of coins) {
      if (coin.classList.contains("is-match")) {
        reset(coin);
        continue;
      }
      const placement = layout.coins[coin.dataset.symbol as keyof typeof layout.coins];
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
