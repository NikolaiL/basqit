import { type Address, formatUnits } from "viem";

export type PackPayout = { token: Address; amount: bigint; slot: number; paid: boolean };

export function payoutValueUsd(amount: bigint, price: number | undefined) {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return undefined;
  const value = Number(formatUnits(amount, 18)) * price;
  return Number.isFinite(value) ? value : undefined;
}

// A partial or stale read must never start a result animation.
export function confirmedPayouts(
  opening: { revealed: boolean; quantity: number } | undefined,
  payouts: readonly PackPayout[] | undefined,
) {
  return opening?.revealed && payouts?.length === opening.quantity ? payouts : undefined;
}

export function payoutLevel<T extends { end: number }>(levels: readonly T[], payout: PackPayout) {
  return levels.find(level => payout.slot < level.end);
}
