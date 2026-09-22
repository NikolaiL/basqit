import type { TradeQuote } from "./quote";

export type QuoteState<T = TradeQuote> = { loading: boolean; quote?: T; error?: string };

// One request at a time; changing the form disposes the previous request and timer.
export function watchQuote<T = TradeQuote>(
  params: string,
  update: (state: QuoteState<T>) => void,
  endpoint = "/api/swap",
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  update({ loading: true });
  async function refresh() {
    if (controller.signal.aborted) return;
    update({ loading: true });
    try {
      const response = await fetch(`${endpoint}?${params}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "Quote unavailable. Try again.");
      if (!Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now())
        throw new Error("Quote expired before arrival. Try again.");
      update({ loading: false, quote: data });
      timer = setTimeout(refresh, Math.max(0, data.expiresAt - Date.now()));
    } catch (error) {
      if (!controller.signal.aborted)
        update({ loading: false, error: error instanceof Error ? error.message : "Quote unavailable. Try again." });
    }
  }
  timer = setTimeout(refresh, 500);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
