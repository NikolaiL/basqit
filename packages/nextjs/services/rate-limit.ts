// Per-consumer allowances for paid or shared upstream APIs, so one caller cannot use up everyone else's budget.
// ponytail: per-process counters; move to a shared store (for example Redis or Vercel KV) before running more than one
// instance, or each instance multiplies the allowance.

const WINDOW = 60_000;
const MAX_BUCKETS = 10_000;
const globals = globalThis as typeof globalThis & {
  basqitAllowances?: Map<string, { start: number; count: number }>;
};
const buckets = (globals.basqitAllowances ??= new Map());

/** Counts one request against `key`'s per-minute allowance; false once it is used up. */
export function takeAllowance(key: string, perMinute: number, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW) {
    buckets.delete(key);
    // Oldest first: a flood of new keys evicts idle ones instead of refusing everybody.
    while (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= perMinute) {
    // Budget metric: the scope only, never the wallet or address behind it.
    console.warn(`[budget] ${key.split(":")[0]} allowance used up`);
    return false;
  }
  bucket.count++;
  return true;
}

/**
 * Who is calling: the signed-in wallet, else the client IP when a trusted proxy sets it, else undefined (no
 * per-client limit; the route's aggregate budget still applies). Forwarding headers are only trustworthy behind a
 * platform that overwrites them: Vercel, or a proxy the operator declares with BASQIT_TRUST_PROXY=true.
 */
export function clientKey(headers: Headers, wallet?: string) {
  if (wallet) return `wallet:${wallet.toLowerCase()}`;
  // Vercel overwrites these headers to prevent spoofing; x-vercel-forwarded-for survives an extra proxy in front
  // (https://vercel.com/docs/headers/request-headers, read 30 September 2026).
  const forwarded =
    process.env.VERCEL === "1"
      ? headers.get("x-vercel-forwarded-for")
      : process.env.BASQIT_TRUST_PROXY === "true"
        ? headers.get("x-forwarded-for")
        : null;
  const ip = forwarded?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : undefined;
}
