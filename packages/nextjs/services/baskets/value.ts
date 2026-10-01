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
