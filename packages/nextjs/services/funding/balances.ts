import { cacheFundingLogos } from "./tokenLogos";

// Preview-only process cache; authenticated access is enforced by the API route.
type Entry = { expires: number; promise: Promise<unknown> };
const globals = globalThis as typeof globalThis & {
  basqitScanCursors?: Map<string, { wallet: string; expires: number }>;
  basqitBalanceCache?: Map<string, Entry>;
};
const cache = (globals.basqitBalanceCache ??= new Map<string, Entry>());
export const FUNDING_NETWORKS = ["eth-mainnet", "base-mainnet", "arb-mainnet", "opt-mainnet"];
export class ScanError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
const cursors = (globals.basqitScanCursors ??= new Map<string, { wallet: string; expires: number }>());
export function readFundingBalances(address: string, pageKey = ""): Promise<unknown> {
  if (process.env.NODE_ENV !== "development" || process.env.BASQIT_ENABLE_WALLET_SCAN !== "true")
    throw new ScanError("Wallet scanning is not enabled.", 503);
  const key = process.env.ALCHEMY_MULTICHAIN_API_KEY?.trim();
  if (!key) throw new ScanError("Wallet scanning is not configured.", 503);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address))
    throw new ScanError("Invalid wallet address.", 400);
  const wallet = address.toLowerCase();
  const now = Date.now();
  for (const [cursor, entry] of cursors) if (entry.expires <= now) cursors.delete(cursor);
  if (pageKey && (cursors.get(pageKey)?.wallet !== wallet || !/^[a-zA-Z0-9_-]{1,128}$/.test(pageKey)))
    throw new ScanError("Scan page expired. Refresh your wallet scan.", 400);
  const cacheKey = `${wallet}:${pageKey}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) return cached.promise;
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  const entry: Entry = { expires: Infinity, promise: Promise.resolve() };
  entry.promise = (async () => {
    try {
      const response = await fetch(
        `https://api.g.alchemy.com/data/v1/${encodeURIComponent(key)}/assets/tokens/by-address`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            addresses: [{ address: wallet, networks: FUNDING_NETWORKS }],
            withMetadata: true,
            withPrices: true,
            includeNativeTokens: true,
            includeErc20Tokens: true,
            includeBlockMetadata: false,
            ...(pageKey ? { pageKey } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error("Upstream unavailable");
      const payload = await response.json();
      if (!Array.isArray(payload?.data?.tokens)) throw new Error("Invalid response");
      const fetchedAt = new Date().toISOString();
      entry.expires = Date.now() + 60000;
      const nextPageKey = payload.data.pageKey ?? payload.pageKey ?? null;
      if (typeof nextPageKey === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(nextPageKey) && cursors.size < 512)
        cursors.set(nextPageKey, { wallet, expires: Date.now() + 600000 });
      return {
        tokens: cacheFundingLogos(payload.data.tokens.slice(0, 100)),
        nextPageKey: cursors.get(nextPageKey)?.wallet === wallet ? nextPageKey : null,
        networks: FUNDING_NETWORKS,
        fetchedAt,
        incomplete: !!payload.data.pageKey || !!payload.pageKey || !!payload.error || payload.data.tokens.length >= 100,
        warning: payload.error ? "Some wallet data could not be loaded." : null,
      };
    } catch {
      entry.expires = Date.now() + 30000;
      // Do not forward/log upstream errors: Alchemy embeds the API key in the URL.
      throw new ScanError("Wallet data is temporarily unavailable.", 503);
    }
  })();
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, entry);
  return entry.promise;
}
