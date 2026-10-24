"use client";

import { useQuery } from "@tanstack/react-query";
import { LoadingBars } from "~~/components/LoadingBars";
import { drandWaitSeconds, fetchLatestDrandRound } from "~~/services/packs/drand";

export function DrandWait({ round, ready }: { round: bigint; ready: boolean }) {
  const latest = useQuery({
    queryKey: ["packs2-drand-latest"],
    queryFn: fetchLatestDrandRound,
    staleTime: 2000,
    refetchInterval: 3000,
    retry: false,
  });
  const seconds = latest.data === undefined ? undefined : drandWaitSeconds(latest.data, round);
  const unavailable = latest.isError || latest.fetchStatus === "paused";
  return (
    <span className="bq-pack-wait">
      <span className="bq-pack-wait-rounds">
        <span>
          {unavailable && latest.data !== undefined ? "Last seen round" : "Current round"}
          <strong>{latest.data?.toString() ?? "…"}</strong>
        </span>
        <span>
          Your round<strong>{round.toString()}</strong>
        </span>
      </span>
      <span className="bq-pack-wait-state">
        {!ready && <LoadingBars small />}
        <span>
          {ready
            ? "Ready to reveal. Confirm below to open your pack."
            : latest.fetchStatus === "paused"
              ? "Connection interrupted. Waiting to reconnect…"
              : latest.isError
                ? "Live round unavailable. Retrying automatically…"
                : seconds === undefined
                  ? "Checking the current round…"
                  : seconds > 0n
                    ? `About ${seconds}s until your round.`
                    : "Fetching your round’s signature…"}
        </span>
      </span>
    </span>
  );
}
