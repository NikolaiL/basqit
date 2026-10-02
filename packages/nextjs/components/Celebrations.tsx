"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SwapConfetti } from "~~/components/trading/SwapConfetti";

const EVENT = "basqit:celebrate";
const BRAND = "/farcaster/icon.png";

/**
 * Confetti for a confirmed, successful transaction: stock tickers show their logos, image paths are used as is, and
 * the Basqit icon stands in when nothing more specific is known.
 */
export function celebrate(symbols: string[] = []) {
  const known = symbols.filter(Boolean);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: known.length ? known : [BRAND] }));
}

/** Mounted once. Draws inside the topmost open dialog, since a modal's top layer hides anything in the body. */
export function Celebrations() {
  const [burst, setBurst] = useState<{ id: number; symbols: string[]; target: Element }>();
  useEffect(() => {
    const onCelebrate = (event: Event) => {
      const dialogs = document.querySelectorAll("dialog[open]");
      setBurst(previous => ({
        id: (previous?.id ?? 0) + 1,
        symbols: (event as CustomEvent<string[]>).detail,
        target: dialogs[dialogs.length - 1] ?? document.body,
      }));
    };
    window.addEventListener(EVENT, onCelebrate);
    return () => window.removeEventListener(EVENT, onCelebrate);
  }, []);
  if (!burst || !burst.target.isConnected) return null;
  return createPortal(<SwapConfetti key={burst.id} symbols={burst.symbols} />, burst.target);
}
