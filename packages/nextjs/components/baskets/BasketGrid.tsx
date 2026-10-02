"use client";

import { useState } from "react";
import Link from "next/link";
import { BasketByline, BasketStats, CreatedAt, useBasketSummary } from "./BasketInfo";
import type { useBasketRows } from "./useBasketRows";
import { type Address, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { BasketTradeDialog } from "~~/components/packs/BasketTradeDialog";
import { useBasketTrades } from "~~/components/packs/useBasketTrades";
import { formatToken, useTestUsdg, useTokens } from "~~/components/packs/usePacks";
import { planStatus } from "~~/services/baskets/plan";
import { totalValue } from "~~/services/baskets/value";
import { shortAmount } from "~~/services/portfolio/format";

export type BasketRow = NonNullable<ReturnType<typeof useBasketRows>["data"]>["rows"][number];

/**
 * Basket cards with Buy and Sell, for the baskets page and creator profiles. `checkedAt` is chain time: the contract
 * judges an announced change's notice window by it.
 */
export function BasketGrid({
  rows,
  feesOn,
  checkedAt,
  busy = false,
}: {
  rows: BasketRow[];
  feesOn: boolean;
  checkedAt: number;
  busy?: boolean;
}) {
  const { address } = useAccount();
  const tokens = useTokens();
  const summary = useBasketSummary();
  const trade = useBasketTradeDialog(rows, feesOn);
  const label = (token: Address) => tokens.data?.[token.toLowerCase()];

  /** "Changes in 14 h: less tAAPL, more tNVDA" while a change is announced; nothing once it lapses. */
  const pendingBanner = (row: BasketRow) => {
    if (!row.change) return null;
    const status = planStatus({
      now: checkedAt,
      readyAt: row.readyAt,
      window: 86_400,
      lastRebalanceAt: row.lastRebalanceAt,
      interval: 14_400,
    });
    if (status.state === "none" || status.state === "lapsed") return null;
    const names = (list: readonly Address[]) => list.map(token => label(token)?.symbol ?? "…").join(", ");
    const what = `less ${names(row.change.sells)}, more ${names(row.change.buys)}`;
    return (
      <p className="bq-basket-pending" role="status">
        {status.state === "ready"
          ? `Change ready to execute: ${what}`
          : status.state === "blocked"
            ? `Announced change cannot run in time: ${what}`
            : `Changes in ${Math.ceil((status.opensAt - checkedAt) / 3600)} h: ${what}`}
      </p>
    );
  };

  return (
    <>
      <div className="bq-demo-grid bq-basket-grid">
        {rows.map(row => {
          const managed = BigInt(row.rules.manager) !== 0n;
          const mine = !!address && row.creator.toLowerCase() === address.toLowerCase();
          const stats = summary.data?.[row.basket.toLowerCase()];
          return (
            <article
              key={row.basket}
              className={`bq-basket-card${managed ? " is-managed" : ""}${mine ? " is-mine" : ""}`}
            >
              <header className="bq-basket-card-head">
                <div className="bq-basket-card-title">
                  <h4>
                    {row.name} <span className="bq-basket-symbol">{row.symbol}</span>
                  </h4>
                  <span className="bq-basket-tags">
                    <span className="bq-basket-type">{managed ? "Managed" : "Fixed"}</span>
                    {mine && <span className="bq-basket-mine">Yours</span>}
                  </span>
                </div>
                <BasketByline creator={row.creator} />
                {managed && (
                  <p className="bq-basket-rules-line">
                    {row.rules.noticeSeconds ? `${row.rules.noticeSeconds / 3600} h notice` : "No notice"}, max{" "}
                    {row.rules.maxSlippageBps / 100}% slippage
                  </p>
                )}
                {pendingBanner(row)}
              </header>
              <div className="bq-basket-card-body">
                <div className="bq-basket-card-holdings">
                  <p className="bq-basket-card-label">
                    {row.parts.length > 5 ? `${row.parts.length} tokens per share` : "One share holds"}
                  </p>
                  {/* Focusable, so the list scrolls by keyboard when it is longer than the panel. */}
                  <ul
                    className="bq-demo-items"
                    tabIndex={row.parts.length > 5 ? 0 : undefined}
                    aria-label={`Holdings of ${row.name}`}
                  >
                    {row.parts.map(part => {
                      const info = label(part.token);
                      return (
                        <li key={part.token}>
                          <StockLogo symbol={info?.ticker ?? ""} size={22} />
                          <span className="bq-holding-name">{info?.symbol ?? "…"}</span>
                          <span
                            className="bq-holding-qty"
                            title={info ? formatUnits(part.unitsPerShare, info.decimals) : undefined}
                          >
                            {info ? shortAmount(formatUnits(part.unitsPerShare, info.decimals)) : "…"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="bq-basket-card-price">
                  <p title="Value per share × shares out: the value of all tokens the basket holds (its TVL)">
                    <strong>{row.perShare ? formatToken(totalValue(row.perShare, row.supply), 6) : "…"}</strong>
                    <span>tUSDG total value</span>
                  </p>
                  <ul className="bq-basket-card-facts">
                    <li>
                      {formatToken(row.supply, 18)} {row.supply === 10n ** 18n ? "share" : "shares"} out
                    </li>
                    <li title={row.perShare ? `${formatToken(row.perShare, 6)} tUSDG a share` : undefined}>
                      {row.perShare ? formatToken(row.perShare, 6) : "…"} per share
                    </li>
                    {stats && (
                      <li>
                        Created <CreatedAt at={stats.createdAt} />
                      </li>
                    )}
                    {row.balance > 0n && (
                      <li>
                        <b>You hold {formatToken(row.balance, 18)}</b>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
              <BasketStats perShare={row.perShare} refs={stats?.refs} />
              <footer className="bq-basket-card-actions">
                <button disabled={busy} onClick={() => trade.open(row.basket, "buy")}>
                  Buy
                </button>
                <button disabled={busy || row.balance === 0n} onClick={() => trade.open(row.basket, "sell")}>
                  Sell
                </button>
                <Link href={`/baskets/${row.basket}`}>Details</Link>
              </footer>
            </article>
          );
        })}
      </div>
      {trade.dialog}
    </>
  );
}

/** Buy and Sell for a list of baskets: `open` shows the trade dialog, `dialog` renders it. Trades use the connected
 * wallet. */
export function useBasketTradeDialog(rows: BasketRow[], feesOn: boolean) {
  const { address } = useAccount();
  const { buy, sell } = useBasketTrades();
  const usdgBalance = useTestUsdg(address).data;
  const [trading, setTrading] = useState<{ basket: Address; side: "buy" | "sell" }>();
  const traded = rows.find(row => row.basket === trading?.basket);
  // Fees switched off on testnet are not charged, so they are not estimated either.
  const fee = traded && feesOn ? traded.feeBps : 0n;
  return {
    open: (basket: Address, side: "buy" | "sell") => setTrading({ basket, side }),
    dialog: traded && trading && (
      <BasketTradeDialog
        key={`${traded.basket}-${trading.side}`}
        basket={{
          symbol: traded.symbol,
          name: traded.name,
          perShare: traded.perShare,
          feeBps: fee,
          shares: traded.balance,
        }}
        initialSide={trading.side}
        usdg={usdgBalance}
        onBuy={budget => buy(traded.basket, budget, traded.perShare, fee)}
        onSell={amount => sell(traded.basket, amount, fee)}
        onClose={() => setTrading(undefined)}
      />
    ),
  };
}

/** Up to three of the basket's stock logos, overlapped: the basket's mark in list rows. */
export function BasketMark({ tickers }: { tickers: string[] }) {
  return (
    <span className="bq-basket-mark" aria-hidden>
      {tickers.slice(0, 3).map((ticker, i) => (
        <StockLogo key={i} symbol={ticker} size={24} />
      ))}
    </span>
  );
}
