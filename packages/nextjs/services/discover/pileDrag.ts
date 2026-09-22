/** Drag the whole coin; independent translation preserves its border and rotation. */
export function attachPileDrag(scene: HTMLElement, onDrop?: (coin: HTMLElement) => void) {
  let drag:
    | {
        coin: HTMLElement;
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        minX: number;
        maxX: number;
        minY: number;
        x: number;
        y: number;
        moved: boolean;
      }
    | undefined;
  let suppressedClick: HTMLElement | undefined;
  const touched = new Set<HTMLElement>();
  const falling = new Map<HTMLElement, Animation>();
  const coinAt = (event: Event) => (event.target as Element).closest<HTMLElement>(".bq-discover-coin");

  function down(event: PointerEvent) {
    const coin = coinAt(event);
    if (drag || !event.isPrimary || event.button !== 0 || !coin || coin.classList.contains("is-match")) return;
    suppressedClick = undefined;
    const [x = 0, y = 0] = getComputedStyle(coin)
      .translate.split(" ")
      .map(value => parseFloat(value) || 0);
    falling.get(coin)?.cancel();
    falling.delete(coin);
    coin.classList.remove("is-falling");
    coin.style.translate = `${x}px ${y}px`;
    const bounds = scene.getBoundingClientRect();
    const rect = coin.getBoundingClientRect();
    drag = {
      coin,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: x,
      originY: y,
      x,
      y,
      moved: false,
      minX: x + bounds.left - rect.left,
      maxX: x + bounds.right - rect.right,
      minY: y + bounds.top - rect.top,
    };
    touched.add(coin);
    coin.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.coin.classList.add("is-dragging");
    drag.x = Math.max(drag.minX, Math.min(drag.maxX, drag.originX + dx));
    drag.y = Math.min(0, Math.max(drag.minY, drag.originY + dy));
    drag.coin.style.translate = `${drag.x}px ${drag.y}px`;
  }
  function release(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { coin, pointerId, x, y, moved } = drag;
    drag = undefined;
    if (coin.hasPointerCapture(pointerId)) coin.releasePointerCapture(pointerId);
    coin.classList.remove("is-dragging");
    if (moved) {
      suppressedClick = coin;
      onDrop?.(coin);
    }
    coin.style.translate = `${x}px 0px`;
    if (y >= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    coin.classList.add("is-falling");
    const animation = coin.animate([{ translate: `${x}px ${y}px` }, { translate: `${x}px 0px` }], {
      duration: Math.sqrt((2 * -y) / 0.003),
      // Constant downward acceleration, with no sideways snap to the old position.
      easing: "cubic-bezier(0.333333, 0, 0.666667, 0.333333)",
    });
    falling.set(coin, animation);
    animation.onfinish = () => {
      falling.delete(coin);
      coin.classList.remove("is-falling");
    };
  }
  function click(event: MouseEvent) {
    if (event.detail && coinAt(event) === suppressedClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressedClick = undefined;
    }
  }
  function preventNativeDrag(event: DragEvent) {
    if (coinAt(event)) event.preventDefault();
  }
  scene.addEventListener("pointerdown", down);
  scene.addEventListener("pointermove", move);
  scene.addEventListener("pointerup", release);
  scene.addEventListener("pointercancel", release);
  scene.addEventListener("lostpointercapture", release);
  scene.addEventListener("click", click, true);
  scene.addEventListener("dragstart", preventNativeDrag);
  return () => {
    scene.removeEventListener("pointerdown", down);
    scene.removeEventListener("pointermove", move);
    scene.removeEventListener("pointerup", release);
    scene.removeEventListener("pointercancel", release);
    scene.removeEventListener("lostpointercapture", release);
    scene.removeEventListener("click", click, true);
    scene.removeEventListener("dragstart", preventNativeDrag);
    if (drag?.coin.hasPointerCapture(drag.pointerId)) drag.coin.releasePointerCapture(drag.pointerId);
    falling.forEach(animation => animation.cancel());
    touched.forEach(coin => {
      coin.style.removeProperty("translate");
      coin.classList.remove("is-dragging", "is-falling");
    });
  };
}
