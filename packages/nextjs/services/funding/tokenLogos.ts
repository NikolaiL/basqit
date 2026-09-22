import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TTL = 30 * 24 * 60 * 60 * 1000;
const file = join(process.cwd(), ".next/cache/funding-token-logos.json");
type Entry = { logo: string | null; expires: number };
let cache: Record<string, Entry> | undefined;

export function safeTokenLogo(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {}
}

// Public logo metadata only; balances and wallet addresses never enter this disk cache.
// ponytail: one local preview process, move to shared storage if deployed across instances.
export function cacheFundingLogos(rows: unknown[], cacheEmpty = false): unknown[] {
  if (!rows.length) return rows;
  if (!cache) {
    cache = {};
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      for (const [key, value] of Object.entries(saved).slice(0, 2000)) {
        const entry = value as Entry;
        if (
          (entry?.logo === null || safeTokenLogo(entry?.logo)) &&
          Number.isFinite(entry.expires) &&
          entry.expires > Date.now()
        )
          cache[key] = entry;
      }
    } catch {
      /* A missing or corrupt optional cache must not prevent a wallet scan. */
    }
  }
  let changed = false;
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.expires <= Date.now()) {
      delete cache[key];
      changed = true;
    }
  }
  const result = rows.map(row => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, any>;
    if (
      !["eth-mainnet", "base-mainnet", "arb-mainnet", "opt-mainnet"].includes(r.network) ||
      (r.tokenAddress != null && (typeof r.tokenAddress !== "string" || !/^0x[0-9a-f]{40}$/i.test(r.tokenAddress)))
    )
      return row;
    const key = `${r.network}:${r.tokenAddress?.toLowerCase() ?? "native"}`;
    const fresh = safeTokenLogo(r.tokenMetadata?.logo);
    if (!cache![key] && (fresh || cacheEmpty)) {
      if (Object.keys(cache!).length >= 2000) delete cache![Object.keys(cache!)[0]];
      cache![key] = { logo: fresh ?? null, expires: Date.now() + (fresh ? TTL : 7 * 86400000) };
      changed = true;
    }
    return { ...r, tokenMetadata: { ...r.tokenMetadata, logo: cache![key]?.logo ?? fresh ?? null } };
  });
  if (changed) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(cache));
      renameSync(`${file}.tmp`, file);
    } catch {
      /* Keep the in-memory cache if the filesystem is unavailable. */
    }
  }
  return result;
}

const requests = new Map<string, Promise<string | null>>();
const globals = globalThis as typeof globalThis & {
  basqitLogoBudget?: { minute: number; day: number; minuteCount: number; dayCount: number };
};
const budget = (globals.basqitLogoBudget ??= { minute: 0, day: 0, minuteCount: 0, dayCount: 0 });
export async function readFundingTokenLogo(network: string, address: string): Promise<string | null> {
  if (
    !["eth-mainnet", "base-mainnet", "arb-mainnet", "opt-mainnet"].includes(network) ||
    !/^0x[0-9a-f]{40}$/i.test(address)
  )
    throw new Error("Invalid token.");
  address = address.toLowerCase();
  const row = { network, tokenAddress: address };
  cacheFundingLogos([row]);
  const id = `${network}:${address}`;
  if (cache![id]) return cache![id].logo;
  if (requests.has(id)) return requests.get(id)!;
  if (process.env.NODE_ENV !== "development" || process.env.BASQIT_ENABLE_WALLET_SCAN !== "true")
    throw new Error("Token metadata is not enabled.");
  const apiKey = process.env.ALCHEMY_MULTICHAIN_API_KEY?.trim();
  if (!apiKey) throw new Error("Token metadata is not configured.");
  const now = Date.now();
  if (now - budget.minute >= 60000) {
    budget.minute = now;
    budget.minuteCount = 0;
  }
  if (now - budget.day >= 86400000) {
    budget.day = now;
    budget.dayCount = 0;
  }
  if (budget.minuteCount >= 30 || budget.dayCount >= 200 || requests.size >= 8)
    throw new Error("Token metadata request limit reached.");
  budget.minuteCount++;
  budget.dayCount++;
  const request = (async () => {
    try {
      const response = await fetch(`https://${network}.g.alchemy.com/v2/${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getTokenMetadata", params: [address] }),
      });
      const data = await response.json();
      if (!response.ok || data.error || !data.result || typeof data.result !== "object")
        throw new Error("Metadata unavailable");
      const logo = safeTokenLogo(data.result.logo) ?? null;
      cacheFundingLogos([{ ...row, tokenMetadata: { logo } }], true);
      return logo;
    } catch {
      // Short retry cooldown for provider failures; never expose the credential-bearing URL.
      cache![id] = { logo: null, expires: Date.now() + 5 * 60000 };
      return null;
    }
  })();
  requests.set(id, request);
  void request.finally(() => requests.delete(id));
  return request;
}
