"use client";

import { useEffect, useId, useRef } from "react";
import { STOCK_LOGO_FALLBACK } from "~~/components/StockLogo";
import logos from "~~/services/discover/logos.json";

export function SwapConfetti({ symbols }: { symbols: string[] }) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const symbolKey = JSON.stringify([...new Set(symbols)]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let started = false;
    let container: { destroy: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadLogo = (src: string): Promise<string | undefined> =>
      new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(src);
        image.onerror = () => {
          if (src === STOCK_LOGO_FALLBACK) resolve(undefined);
          else void loadLogo(STOCK_LOGO_FALLBACK).then(resolve);
        };
        image.src = src;
      });
    const tokens = JSON.parse(symbolKey) as string[];
    const ready = Promise.all([
      import("@tsparticles/confetti"),
      Promise.all(tokens.map(token => loadLogo((logos as Record<string, string>)[token] ?? STOCK_LOGO_FALLBACK))),
    ]);
    const start = async () => {
      if (disposed || started || document.visibilityState !== "visible" || !document.hasFocus()) return;
      started = true;
      try {
        const [{ confetti }, loaded] = await ready;
        if (disposed || !canvas.current) return;
        if (document.visibilityState !== "visible" || !document.hasFocus()) {
          started = false;
          return;
        }
        const sources = [...new Set(loaded.filter((src): src is string => !!src))];
        if (!sources.length) return;
        // Keep the canvas inside the native dialog's top layer; the default body canvas is hidden behind it.
        const fire = await confetti.create(canvas.current, { count: 0 });
        container = await fire({
          count: disposed ? 0 : 72,
          angle: 90,
          spread: 85,
          startVelocity: 38,
          gravity: 0.85,
          decay: 0.93,
          ticks: 240,
          scalar: 2.8,
          position: { x: 50, y: 42 },
          shapes: ["image"],
          shapeOptions: { image: sources.map(src => ({ src, width: 32, height: 32 })) },
          disableForReducedMotion: true,
        });
        if (disposed) container?.destroy();
        else timer = setTimeout(() => container?.destroy(), 6000);
      } catch {
        // A cosmetic effect must never interrupt a confirmed purchase.
        container?.destroy();
      }
    };
    const onFocus = () => void start();
    onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      container?.destroy();
    };
  }, [symbolKey]);
  return (
    <canvas
      id={id}
      ref={canvas}
      aria-hidden="true"
      data-swap-confetti
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1000 }}
    />
  );
}
