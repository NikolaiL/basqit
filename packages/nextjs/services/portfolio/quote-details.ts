// ponytail: shared per-process queue/cache; use a shared rate limiter before deploying multiple replicas.
type Entry = { expires: number; promise: Promise<unknown> };
const state = globalThis as typeof globalThis & {
  basqitQuoteDetails?: {
    entries: Map<string, Entry>;
    queue: Promise<unknown>;
    nextAt: number;
  };
};
const cache = (state.basqitQuoteDetails ??= { entries: new Map(), queue: Promise.resolve(), nextAt: 0 });

export function readQuoteDetails(symbol: string): Promise<unknown> {
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) return Promise.reject(new Error("Invalid symbol"));
  const existing = cache.entries.get(symbol);
  if (existing && existing.expires > Date.now()) return existing.promise;
  // Bound memory, including failed requests for unknown symbols.
  for (const [key, entry] of cache.entries) if (entry.expires <= Date.now()) cache.entries.delete(key);
  if (cache.entries.size >= 256) return Promise.reject(new Error("Quote queue busy"));
  const entry: Entry = { expires: Infinity, promise: Promise.resolve() };
  entry.promise = cache.queue
    .catch(() => {})
    .then(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, cache.nextAt - Date.now())));
      cache.nextAt = Date.now() + 50;
      try {
        const response = await fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = Number(retry);
          const wait =
            retry && Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 60000;
          cache.nextAt = Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 60000);
        }
        if (!response.ok) throw new Error("Quote unavailable");
        const payload = await response.json();
        const quote = Array.isArray(payload?.quotes)
          ? payload.quotes.find((q: { tokenSymbol?: string }) => q?.tokenSymbol === symbol)
          : undefined;
        if (
          !quote ||
          quote.currency !== "USD" ||
          typeof quote.generatedAt !== "string" ||
          !Number.isFinite(Date.parse(quote.generatedAt))
        )
          throw new Error("Invalid quote");
        entry.expires = Date.now() + 60000;
        return quote;
      } catch (error) {
        entry.expires = Date.now() + 15000;
        throw error;
      }
    });
  cache.entries.set(symbol, entry);
  cache.queue = entry.promise.catch(() => {});
  return entry.promise;
}
