import { type Address } from "viem";

export type PackPayout = { token: Address; amount: bigint; slot: number; paid: boolean };

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
