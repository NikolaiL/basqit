"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { amount, decimalPattern, money } from "~~/services/portfolio/format";

export function QuoteDetails({ symbol, address }: { symbol: string; address: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: ["quote-details", symbol, address],
    enabled: visible,
    staleTime: 15000,
    refetchInterval: visible ? 15000 : false,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/stocks/details?symbol=${encodeURIComponent(symbol)}`, { signal });
      if (!response.ok) throw new Error("Details unavailable");
      const quote = await response.json();
      if (
        quote.tokenSymbol !== symbol ||
        quote.currency !== "USD" ||
        !Array.isArray(quote.deployments) ||
        !quote.deployments.some(
          (d: { chainId?: number; contractAddress?: string }) =>
            d?.chainId === 4663 &&
            typeof d.contractAddress === "string" &&
            d.contractAddress.toLowerCase() === address.toLowerCase(),
        )
      )
        throw new Error("Mismatched quote");
      const positive = (value: unknown) =>
        typeof value === "string" && decimalPattern.test(value) && Number(value) > 0 ? value : null;
      return {
        volume: positive(quote.dailyTradingVolume),
        high: positive(quote.dailyHigh),
        low: positive(quote.dailyLow),
        at: typeof quote.generatedAt === "string" ? quote.generatedAt : "",
      };
    },
  });
  const missing = query.isFetching && !query.data ? "Loading…" : "Unavailable";
  return (
    <div ref={ref} className="bq-quote-details" aria-label={`${symbol} underlying market details`}>
      <span>Daily volume · underlying: {query.data?.volume ? amount(query.data.volume, 2) : missing}</span>
      <span>Daily high · underlying: {query.data?.high ? money(query.data.high) : missing}</span>
      <span>Daily low · underlying: {query.data?.low ? money(query.data.low) : missing}</span>
      {query.data?.at && (
        <small title="Issuer response time, not the last market tick. Session boundaries are not specified by the API.">
          Details as of{" "}
          {new Date(query.data.at).toLocaleString("en-GB", {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          UTC
        </small>
      )}
      {query.isError && (
        <button className="link" onClick={() => void query.refetch()}>
          Retry market details
        </button>
      )}
    </div>
  );
}
