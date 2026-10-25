"use client";

import { useEffect, useState } from "react";
import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { LoadingBars } from "~~/components/LoadingBars";
import { drandWaitSeconds, fetchLatestDrandRound } from "~~/services/packs/drand";

export function DrandWait({ round, ready }: { round: bigint; ready: boolean }) {
  const latest = useQuery({
    queryKey: ["packs2-drand-latest"],
    queryFn: fetchLatestDrandRound,
    staleTime: 2000,
    refetchInterval: 3000,
    refetchOnMount: "always",
    refetchIntervalInBackground: true,
    structuralSharing: (previous, next) =>
      typeof previous === "bigint" && typeof next === "bigint" && previous > next ? previous : next,
    retry: false,
  });
  const source = `${latest.data}:${round}`;
  const [clock, setClock] = useState({ source: "", elapsedMs: 0 });
  useEffect(() => {
    if (latest.data === undefined || ready) return;
    const start = performance.now();
    const timer = setInterval(() => setClock({ source, elapsedMs: performance.now() - start }), 1000);
    return () => clearInterval(timer);
  }, [latest.data, source, ready]);
  // A target signature proves that the published round has reached at least this opening's round.
  const confirmedAhead = ready && (latest.data === undefined || latest.data < round);
  const current = confirmedAhead ? round : latest.data;
  const seconds =
    current === undefined ? undefined : drandWaitSeconds(current, round, clock.source === source ? clock.elapsedMs : 0);
  const unavailable = latest.isError || latest.fetchStatus === "paused";
  return (
    <span className="bq-pack-wait">
      <span className="bq-pack-wait-rounds">
        <span>
          {confirmedAhead
            ? "Confirmed through round"
            : unavailable && latest.data !== undefined
              ? "Last seen round"
              : "Current round"}
          <strong>{current?.toString() ?? "…"}</strong>
        </span>
        <span>
          Your round<strong>{round.toString()}</strong>
        </span>
      </span>
      <span className="bq-pack-wait-state">
        {!ready && <LoadingBars small />}
        <span>
          {ready ? (
            "Ready to reveal. Confirm below to open your pack."
          ) : latest.fetchStatus === "paused" ? (
            "Connection interrupted. Waiting to reconnect…"
          ) : latest.isError ? (
            "Live round unavailable. Retrying automatically…"
          ) : seconds === undefined ? (
            "Checking the current round…"
          ) : seconds > 0n ? (
            <span role="timer" aria-live="off" aria-label={`About ${seconds} seconds until your round`}>
              About <NumberFlow value={Number(seconds)} format={{ useGrouping: false }} suffix="s" /> until your round.
            </span>
          ) : (
            "Fetching your round’s signature…"
          )}
        </span>
      </span>
    </span>
  );
}
