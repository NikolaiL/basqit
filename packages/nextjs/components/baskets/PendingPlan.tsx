"use client";

import { formatToken, useTokens } from "~~/components/packs/usePacks";
import type { Component } from "~~/services/baskets/value";

export const when = (at: number) =>
  new Date(at * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** An announced rebalance in plain words: each reduced holding before → after, and where the proceeds go. */
export function PendingPlan({
  sells,
  buys,
  components,
}: {
  sells: readonly { token: string; unitsPerShare: bigint }[];
  buys: readonly { token: string; bps: number }[];
  components: Component[];
}) {
  const tokens = useTokens();
  const label = (token: string) => tokens.data?.[token.toLowerCase()];
  const decimals = (token: string) => label(token)?.decimals ?? 18;
  return (
    <ul className="bq-manage-plan">
      {sells.map(s => {
        const before = components.find(c => c.token.toLowerCase() === s.token.toLowerCase());
        return (
          <li key={s.token}>
            {label(s.token)?.symbol ?? "…"} {before ? formatToken(before.unitsPerShare, decimals(s.token)) : "…"} →{" "}
            {s.unitsPerShare === 0n ? "removed" : `${formatToken(s.unitsPerShare, decimals(s.token))} per share`}
          </li>
        );
      })}
      {buys.map(b => (
        <li key={b.token}>
          {label(b.token)?.symbol ?? "…"} gets {b.bps / 100}% of the proceeds
        </li>
      ))}
    </ul>
  );
}
