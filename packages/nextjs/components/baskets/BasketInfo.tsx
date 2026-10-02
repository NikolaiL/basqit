"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { CreatorLink } from "~~/components/creators/CreatorProfile";
import { percentChange, timeAgo } from "~~/services/baskets/value";

type Refs = Record<"24h" | "7d" | "all", string | null>;
type Summary = Record<string, { createdAt: number; refs: Refs }>;

/** Creation time and stored reference values for every basket; see /api/baskets/summary. */
export function useBasketSummary() {
  return useQuery({
    queryKey: ["basket-summary"],
    staleTime: 60_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const response = await fetch("/api/baskets/summary");
      if (!response.ok) throw new Error("Could not load basket stats");
      return (await response.json()) as Summary;
    },
  });
}

/** "2 days ago"; a click shows the exact date and time, and back. */
export function CreatedAt({ at }: { at: number }) {
  const [exact, setExact] = useState(false);
  const date = new Date(at * 1000);
  return (
    <button
      type="button"
      className="bq-basket-when"
      onClick={() => setExact(!exact)}
      title={exact ? "Show how long ago" : date.toLocaleString()}
    >
      <time dateTime={date.toISOString()}>{exact ? date.toLocaleString() : timeAgo(at)}</time>
    </button>
  );
}

/** Ticker, then who made the basket and when. */
export function BasketByline({ symbol, creator, createdAt }: { symbol: string; creator: Address; createdAt?: number }) {
  return (
    <p className="bq-basket-byline">
      <span className="bq-basket-symbol">{symbol}</span>
      <span>
        by <CreatorLink address={creator} />
        {createdAt !== undefined && (
          <>
            , <CreatedAt at={createdAt} />
          </>
        )}
      </span>
    </p>
  );
}

const WINDOWS = [
  ["24h", "24h"],
  ["7d", "7 days"],
  ["all", "All time"],
] as const;

/** Value change over 24h, 7 days and all time, as a strip of three cells. */
export function BasketStats({ perShare, refs }: { perShare: bigint; refs?: Refs }) {
  return (
    <dl className="bq-basket-stats">
      {WINDOWS.map(([key, name]) => {
        const change = perShare ? percentChange(perShare, refs?.[key] ?? null) : null;
        return (
          <div key={key}>
            <dd className={change?.startsWith("+") ? "is-up" : change?.startsWith("−") ? "is-down" : undefined}>
              {change ?? "—"}
            </dd>
            <dt>{name}</dt>
          </div>
        );
      })}
    </dl>
  );
}
