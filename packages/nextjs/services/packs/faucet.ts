export function faucetAvailability({
  lastDrip,
  cooldown,
  now,
  amount,
  dailyCap,
  minted,
}: {
  lastDrip: bigint;
  cooldown: bigint;
  now: bigint;
  amount: bigint;
  dailyCap: bigint;
  minted: bigint;
}) {
  const nextAt = lastDrip + cooldown;
  const wait = lastDrip > 0n && nextAt > now ? nextAt - now : 0n;
  const capped = minted + amount > dailyCap;
  return { wait, capped, ready: wait === 0n && !capped };
}
