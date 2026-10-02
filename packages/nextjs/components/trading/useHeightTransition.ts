import { useLayoutEffect, useRef } from "react";

/**
 * Animates an element's height when `trigger` changes, e.g. a receipt shrinking to its completed view. Call `note()`
 * just before the state change; the height then moves from the noted one to the new one. Skipped for reduced motion.
 */
export function useHeightTransition<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  const before = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const from = before.current;
    before.current = undefined;
    if (from === undefined || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = ref.current.getBoundingClientRect().height;
    ref.current.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 320,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }, [trigger]);
  return { ref, note: () => (before.current = ref.current?.getBoundingClientRect().height) };
}
