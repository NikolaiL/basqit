"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { Arrow } from "~~/components/Arrow";
import { BasketMark, useBasketTradeDialog } from "~~/components/baskets/BasketGrid";
import { useBasketSummary } from "~~/components/baskets/BasketInfo";
import { useBasketRows } from "~~/components/baskets/useBasketRows";
import { formatToken, useTokens } from "~~/components/packs/usePacks";
import { percentChange, totalValue } from "~~/services/baskets/value";

/**
 * Basket shares `address` holds on Robinhood Chain testnet, as rows like the Stock Token holdings above. Buy and Sell
 * trade from the connected wallet, so Sell only shows when the page shows that wallet.
 */
export function OwnedBaskets({ address }: { address: Address }) {
  const { address: connected } = useAccount();
  const baskets = useBasketRows(address);
  const summary = useBasketSummary();
  const tokens = useTokens();
  const held = baskets.data?.rows.filter(row => row.balance > 0n) ?? [];
  const trade = useBasketTradeDialog(held, !!baskets.data?.feesOn);
  const own = connected?.toLowerCase() === address.toLowerCase();
  const total = held.reduce((sum, row) => sum + totalValue(row.perShare, row.balance), 0n);

  return (
    <section className="bq-section card" aria-labelledby="baskets-title">
      <div className="bq-section-heading">
        <div>
          <h2 id="baskets-title">
            Your baskets{" "}
            <span className="bq-count" role="status">
              {baskets.isPending ? "Loading…" : held.length}
            </span>
          </h2>
          <p>
            Testnet, test tokens only.
            {held.length > 0 && ` ${formatToken(total, 6)} tUSDG in total.`}
          </p>
          <Link className="link" href="/baskets">
            Browse baskets <Arrow />
          </Link>
        </div>
      </div>
      {baskets.isError && (
        <p className="bq-demo-error" role="alert">
          Could not load baskets.{" "}
          <button className="btn btn-sm" onClick={() => baskets.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="bq-holdings-list" aria-busy={baskets.isPending}>
        {baskets.isPending &&
          [0, 1].map(i => <div key={i} className="skeleton bq-holding-skeleton" aria-label="Loading basket" />)}
        {held.map(row => {
          const change = percentChange(row.perShare, summary.data?.[row.basket.toLowerCase()]?.refs["24h"] ?? null);
          const mine = row.creator.toLowerCase() === address.toLowerCase();
          return (
            <div className="bq-asset-list-row bq-asset-action-row" key={row.basket}>
              <Link
                className="bq-asset-row-details"
                href={`/baskets/${row.basket}`}
                aria-label={`View ${row.name} basket`}
              >
                <BasketMark tickers={row.parts.map(part => tokens.data?.[part.token.toLowerCase()]?.ticker ?? "")} />
                <span className="bq-list-identity">
                  <strong>
                    {row.name}
                    {mine && <span className="bq-basket-mine">Yours</span>}
                  </strong>
                  <small>
                    {row.symbol}, {formatToken(row.balance, 18)} shares
                  </small>
                </span>
                <span className="bq-list-value">
                  <strong>
                    {row.perShare ? `${formatToken(totalValue(row.perShare, row.balance), 6)} tUSDG` : "…"}
                  </strong>
                  <small
                    className={change?.startsWith("+") ? "is-up" : change?.startsWith("−") ? "is-down" : undefined}
                  >
                    {change ? `${change} in 24h` : "Reference value"}
                  </small>
                </span>
              </Link>
              <div className="bq-row-actions">
                <button
                  className="btn btn-primary"
                  aria-label={`Buy ${row.name}`}
                  onClick={() => trade.open(row.basket, "buy")}
                >
                  Buy
                </button>
                {own && (
                  <button
                    className="btn btn-secondary"
                    aria-label={`Sell ${row.name}`}
                    onClick={() => trade.open(row.basket, "sell")}
                  >
                    Sell
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {baskets.isSuccess && held.length === 0 && (
        <div className="bq-empty">
          <h3>No basket shares yet</h3>
          <p>Baskets you buy on testnet will appear here.</p>
        </div>
      )}
      {trade.dialog}
    </section>
  );
}
