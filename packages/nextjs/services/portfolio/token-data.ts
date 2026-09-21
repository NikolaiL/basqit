// ponytail: one process shares this bounded cache/limiter; use shared storage before adding replicas.
type Entry = { expires: number; promise: Promise<Record<string, any>> };
const state = globalThis as typeof globalThis & {
  basqitTokenData?: { entries: Map<string, Entry>; queue: Promise<void>; nextAt: number };
};
const cache = (state.basqitTokenData ??= { entries: new Map(), queue: Promise.resolve(), nextAt: 0 });

export function readTokenData(path: string): Promise<Record<string, any>> {
  if (!/^(assets|corporate-actions|prices(?:\/[A-Z0-9.\-]{1,20})?)$/.test(path))
    return Promise.reject(new Error("Invalid token endpoint"));
  const existing = cache.entries.get(path);
  if (existing && existing.expires > Date.now()) return existing.promise;
  for (const [key, entry] of cache.entries) if (entry.expires <= Date.now()) cache.entries.delete(key);
  if (cache.entries.size >= 256) return Promise.reject(new Error("Token data queue busy"));
  const ttl = path === "assets" ? 300000 : path === "corporate-actions" ? 3600000 : 15000;
  // Serialize starts, not network responses: at most 20 requests/second across all endpoints.
  const turn = cache.queue.then(async () => {
    while (cache.nextAt > Date.now()) await new Promise(resolve => setTimeout(resolve, cache.nextAt - Date.now()));
    cache.nextAt = Date.now() + 50;
  });
  cache.queue = turn.catch(() => {});
  const entry: Entry = { expires: Infinity, promise: Promise.resolve({}) };
  entry.promise = turn.then(async () => {
    try {
      const response = await fetch(`https://api.robinhood.com/rhj/${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 60000;
        cache.nextAt = Math.max(cache.nextAt, Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 60000));
      }
      if (!response.ok) throw new Error("Stock Token data is temporarily unavailable. Please try again.");
      const payload = await response.json();
      const field = path === "assets" ? "assets" : path === "corporate-actions" ? "corpActions" : "quotes";
      if (!payload || !Array.isArray(payload[field])) throw new Error("Invalid token data");
      entry.expires = Date.now() + ttl;
      return payload;
    } catch (error) {
      entry.expires = Date.now() + 15000;
      throw error;
    }
  });
  cache.entries.set(path, entry);
  return entry.promise;
}
