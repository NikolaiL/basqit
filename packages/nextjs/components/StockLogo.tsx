"use client";

import { useState } from "react";
import Image from "next/image";
import logos from "~~/services/discover/logos.json";

export const STOCK_LOGO_FALLBACK = "/token-logos/robinhood.png";

export function StockLogo({ symbol, size = 44 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState<string[]>([]);
  const company = (logos as Record<string, string>)[symbol];
  const source = company && !failed.includes(company) ? company : STOCK_LOGO_FALLBACK;
  return (
    <span className="bq-stock-logo" style={{ width: size, height: size }} aria-hidden="true">
      {!failed.includes(source) ? (
        <Image
          src={source}
          alt=""
          width={size}
          height={size}
          unoptimized
          onError={() => setFailed(previous => [...previous, source])}
        />
      ) : (
        <span>{symbol.slice(0, 3)}</span>
      )}
    </span>
  );
}
