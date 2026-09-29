"use client";

import { useEffect, useState } from "react";
import { StockLogo } from "~~/components/StockLogo";
import { useUsdPrices } from "~~/components/packs/usePacks";

const TOP = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA"];
const VALUES = [2, 5, 10];

/**
 * One opened pack or gift showing $2, $5 or $10 of a top company, sized at its live Stock Token price.
 * Cycles through the companies every few seconds.
 */
function OpenedArt({ kind, headline }: { kind: "pack" | "gift"; headline: string }) {
  const prices = useUsdPrices(TOP).data;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex(i => (i + 1) % TOP.length), 3000);
    return () => clearInterval(timer);
  }, []);
  const symbol = TOP[index];
  const value = VALUES[index % VALUES.length];
  const price = prices?.[symbol];
  const amount = price ? (value / price).toLocaleString("en-US", { maximumSignificantDigits: 3 }) : "…";
  return (
    <div className="bq-soon-art bq-soon-packs-art" aria-hidden="true">
      <div className={`bq-soon-pack is-opened ${kind === "pack" ? "is-pack" : "is-gift"}`}>
        <span className="bq-soon-peek">
          <StockLogo symbol={symbol} size={72} />
        </span>
        <strong>{headline}</strong>
        <span className="bq-soon-pull">
          {amount} {symbol}
        </span>
        <span className="bq-soon-value">${value.toFixed(2)} value</span>
        <small>basqit. {kind}</small>
      </div>
    </div>
  );
}

export const PackArt = () => <OpenedArt kind="pack" headline="Nice pull!" />;
export const GiftArt = () => <OpenedArt kind="gift" headline="For you!" />;
