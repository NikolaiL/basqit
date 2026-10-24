import { useId } from "react";
import { StockLogo } from "~~/components/StockLogo";
import { packPresentation } from "~~/services/packs/catalog";
import { type PackStock } from "~~/services/packs/stocks";

export function PackFace({
  pack,
  stocks = [],
}: {
  pack: ReturnType<typeof packPresentation>;
  stocks?: readonly PackStock[];
}) {
  const foilId = useId();
  return (
    <span className="bq-pack-face">
      <span className="bq-pack-face-top">
        <b>basqit.</b>
        <span>
          VOL.
          <br />
          {pack.mark}
        </span>
      </span>
      <span className="bq-pack-face-art" aria-hidden="true">
        <svg viewBox="0 0 220 190" fill="none">
          <defs>
            <linearGradient id={foilId} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#edbfff" />
              <stop offset=".32" stopColor="#fff1be" />
              <stop offset=".64" stopColor="#a1efd5" />
              <stop offset="1" stopColor="#b9caff" />
            </linearGradient>
          </defs>
          <circle cx="110" cy="95" r="83" stroke="currentColor" strokeOpacity=".2" />
          <circle cx="110" cy="95" r="72" stroke="currentColor" strokeOpacity=".2" />
          <g transform="translate(110 95) rotate(-12)">
            {Array.from({ length: 12 }, (_, i) => (
              <rect
                key={i}
                x="-10"
                y="-72"
                width="20"
                height="61"
                rx="10"
                fill="currentColor"
                transform={`rotate(${i * 30})`}
              />
            ))}
          </g>
          <circle cx="110" cy="95" r="27" fill={`url(#${foilId})`} className="bq-pack-face-medallion" />
          <text x="110" y="105" textAnchor="middle" fill="currentColor">
            {pack.mark}
          </text>
          <path d="M184 14v22m-11-11h22M30 147v18m-9-9h18" stroke="currentColor" strokeWidth="2" />
        </svg>
      </span>
      <span className="bq-pack-face-side">A PIECE OF POSSIBILITY</span>
      <span className="bq-pack-face-band">
        <span className="bq-pack-face-kicker">STOCK TOKENS. UNWRAPPED.</span>
        <strong>{pack.name}</strong>
        <span className="bq-pack-face-bottom">
          <span>TEST EDITION</span>
          <b>{pack.label}</b>
        </span>
      </span>
      <span className="bq-pack-face-stocks">
        {stocks.map(stock => (
          <StockLogo key={stock.address} symbol={stock.ticker} size={18} />
        ))}
        <span>{pack.tagline}</span>
      </span>
    </span>
  );
}
