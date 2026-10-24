export const PACK_TYPES = [
  {
    id: 1,
    price: 1_000_000n,
    name: "Bronze",
    label: "$1",
    color: "#d49a72",
    mark: "I",
    tagline: "START SOMETHING SMALL",
  },
  {
    id: 2,
    price: 10_000_000n,
    name: "Silver",
    label: "$10",
    color: "#c7d4e1",
    mark: "II",
    tagline: "MORE TO DISCOVER",
  },
  {
    id: 3,
    price: 100_000_000n,
    name: "Gold",
    label: "$100",
    color: "#e9bd52",
    mark: "III",
    tagline: "A BIGGER LITTLE MOMENT",
  },
] as const;

export function packPresentation(price?: bigint) {
  return (
    PACK_TYPES.find(pack => pack.price === price) ?? {
      name: "Original",
      label: "Original",
      color: "var(--bq-brand)",
      mark: "✦",
      tagline: "A PIECE OF POSSIBILITY",
    }
  );
}

export function rankedPayouts<T extends { token: string; amount: bigint; end: number }>(
  tiers: readonly T[],
  prices: Record<string, number | undefined>,
) {
  const priced = tiers.every(tier => (prices[tier.token.toLowerCase()] ?? 0) > 0);
  return tiers
    .map((tier, index) => ({ tier, index, chance: (tier.end - (index ? tiers[index - 1].end : 0)) / 10 }))
    .sort((a, b) => {
      const aPrice = prices[a.tier.token.toLowerCase()];
      const bPrice = prices[b.tier.token.toLowerCase()];
      return priced ? Number(b.tier.amount) * bPrice! - Number(a.tier.amount) * aPrice! : b.index - a.index;
    });
}

export type StockOption = { token: string; referencePriceUsdG: bigint; amounts: readonly bigint[] };

export function averagePayout(
  tiers: readonly { token: string; amount: bigint; end: number }[],
  prices: Record<string, number | undefined>,
  pool: readonly StockOption[] = [],
): number | undefined {
  if (pool.length) {
    const values = pool.map(stock =>
      averagePayout(
        tiers.map((tier, index) => ({ ...tier, token: stock.token, amount: stock.amounts[index] })),
        prices,
      ),
    );
    return values.some(value => value === undefined)
      ? undefined
      : values.reduce<number>((sum, value) => sum + value!, 0) / pool.length;
  }
  if (tiers.some(tier => !prices[tier.token.toLowerCase()])) return undefined;
  return tiers.reduce(
    (sum, tier, index) =>
      sum +
      ((Number(tier.amount) / 1e18) *
        prices[tier.token.toLowerCase()]! *
        (tier.end - (index ? tiers[index - 1].end : 0))) /
        1000,
    0,
  );
}
