import { StockLogo } from "~~/components/StockLogo";

// Hand-stuck stickers: symbol, left %, top px, tilt.
const BASKET = [
  ["NVDA", 8, 58, -12],
  ["AAPL", 26, 14, 8],
  ["TSLA", 46, 0, -6],
  ["AMZN", 66, 16, 10],
  ["META", 84, 60, -8],
] as const;

/** Baskets: the logo's basket with a few companies arching out of it. */
export function BasketArt() {
  return (
    <div className="bq-soon-art bq-soon-basket" aria-hidden="true">
      {BASKET.map(([symbol, left, top, tilt]) => (
        <span key={symbol} className="bq-soon-sticker" style={{ left: `${left}%`, top, rotate: `${tilt}deg` }}>
          <StockLogo symbol={symbol} size={64} />
        </span>
      ))}
      <svg viewBox="0 0 64 64" className="bq-soon-basket-mark">
        <path
          d="M13 22H51L47 50Q46.4 54 42.5 54H21.5Q17.6 54 17 50L13 22Z"
          fill="var(--bq-paper)"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <rect x="22.1" y="36.5" width="5" height="9.5" rx="2.5" fill="#A9A3F6" />
        <rect x="29.5" y="32.5" width="5" height="13.5" rx="2.5" fill="#5A4FE0" />
        <rect x="36.9" y="28.5" width="5" height="17.5" rx="2.5" fill="#FFB020" />
      </svg>
    </div>
  );
}

/** Packs: two sealed packs with a torn top, a couple of tokens peeking out. */
export function PackArt() {
  return (
    <div className="bq-soon-art bq-soon-packs-art" aria-hidden="true">
      <div className="bq-soon-pack is-gift">
        <span className="bq-soon-peek">
          <StockLogo symbol="MSFT" size={56} />
          <StockLogo symbol="GOOGL" size={56} />
        </span>
        <strong>Gift</strong>
        <small>basqit. pack</small>
      </div>
      <div className="bq-soon-pack is-surprise">
        <span className="bq-soon-peek">
          <StockLogo symbol="RKLB" size={56} />
          <b>?</b>
        </span>
        <strong>Surprise</strong>
        <small>basqit. pack</small>
      </div>
    </div>
  );
}
