export type Component = { token: string; unitsPerShare: bigint };

const ONE = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";

/** USDG (6 decimals) for one share: each component at its price per whole token, rounded up like the purchase
 * router; USDG at face. `null` when any other component has no price, so a missing price is never shown as 0. */
export function valuePerShare(components: Component[], prices: Record<string, bigint>, usdg: string): bigint | null {
  let total = 0n;
  for (const { token, unitsPerShare } of components) {
    if (token.toLowerCase() === usdg.toLowerCase()) {
      total += unitsPerShare;
      continue;
    }
    const price = prices[token.toLowerCase()];
    if (!price) return null;
    total += (unitsPerShare * price + ONE - 1n) / ONE;
  }
  return total;
}

/** The basket's fixed rules in one line, for cards and the details header. */
export function rulesLine(rules: { manager: string; noticeSeconds: number; maxSlippageBps: number }) {
  if (rules.manager.toLowerCase() === ZERO) return "Fixed";
  const hours = rules.noticeSeconds / 3600;
  const notice = hours === 0 ? "no notice" : `${hours} h notice`;
  return `Managed · ${notice} · max ${rules.maxSlippageBps / 100}% slippage`;
}

/** Signed change from `ref` to `now`, e.g. "+2.4%"; null without a reference. */
export function percentChange(now: bigint, ref: string | null) {
  if (!ref || BigInt(ref) === 0n || now === 0n) return null;
  const bps = Number(((now - BigInt(ref)) * 10_000n) / BigInt(ref));
  return `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${(Math.abs(bps) / 100).toFixed(Math.abs(bps) < 1000 ? 2 : 1)}%`;
}

/** Total value of all shares: value per share (6 decimals) × supply (18 decimals), in 6 decimals. */
export const totalValue = (perShare: bigint, supply: bigint) => (perShare * supply) / 10n ** 18n;

const UNITS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const;

/** "3 days ago", "just now": the largest whole unit. */
export function timeAgo(at: number, now = Date.now() / 1000, locale = "en") {
  const seconds = Math.max(0, now - at);
  const unit = UNITS.find(([, size]) => seconds >= size);
  if (!unit) return "just now";
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / unit[1]), unit[0]);
}
