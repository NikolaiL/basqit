"use client";

import { useState } from "react";
import { AssetDetails, type DetailAsset } from "./AssetDetails";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { TokenAmount } from "~~/components/TokenAmount";
import { TradeDialog, type TradeSelection } from "~~/components/trading/TradeDialog";
import { useStockPortfolio } from "~~/hooks/scaffold-eth/useStockPortfolio";
import type { tradingSessions } from "~~/services/atlas/tradingSessions";
import { money } from "~~/services/portfolio/format";

export type CatalogAsset = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  multiplier: string | null;
  decimals: number | null;
  isin: string | null;
  status: string;
  sessions: ReturnType<typeof tradingSessions>;
  price?: string | null;
  priceAt?: string;
};

export function AssetCatalog({ assets }: { assets: CatalogAsset[] }) {
  const { address } = useAccount();
  const portfolio = useStockPortfolio(address);
  const balances = new Map(portfolio.data?.holdings.map(holding => [holding.address.toLowerCase(), holding]));
  const [trade, setTrade] = useState<TradeSelection>();
  const [selected, setSelected] = useState<DetailAsset>();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = assets.filter(asset =>
    `${asset.symbol} ${asset.name} ${asset.address} ${asset.isin ?? ""}`.toLowerCase().includes(query),
  );
  return (
    <>
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
      {selected && (
        <AssetDetails
          asset={selected}
          onClose={() => setSelected(undefined)}
          onTrade={selection => {
            setSelected(undefined);
            setTrade(selection);
          }}
        />
      )}
      <div className="bq-catalog-toolbar">
        <label>
          <span className="sr-only">Search tokens</span>
          <input
            className="input input-bordered"
            type="search"
            placeholder="Search by name, symbol or address"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <span role="status">
          {visible.length} of {assets.length} tokens
        </span>
      </div>
      <div className="bq-catalog-grid">
        {visible.map(asset => {
          const holding = balances.get(asset.address.toLowerCase());
          const owned = !!holding && Number(holding.balance) > 0;
          return (
            <div
              key={asset.address}
              className={`bq-asset-list-row bq-asset-action-row${owned ? " bq-asset-owned" : ""}`}
            >
              <button
                className="bq-asset-row-details"
                onClick={() => setSelected({ ...asset, ...holding })}
                aria-label={`View ${asset.symbol}, ${asset.name}`}
              >
                <StockLogo symbol={asset.symbol} size={40} />
                <span className="bq-list-identity">
                  <strong>{asset.symbol}</strong>
                  <small>{asset.name}</small>
                  {owned && (
                    <span className="bq-owned-balance">
                      You own <TokenAmount value={holding.balance} /> ·{" "}
                      {holding.valueUsd === null ? "Value unavailable" : `≈${money(holding.valueUsd)}`}
                    </span>
                  )}
                </span>
                <span className="bq-list-value">
                  <strong>{asset.price ? money(asset.price) : "—"}</strong>
                  <small>{asset.status === "Active" ? "Reference / token" : asset.status}</small>
                </span>
              </button>
              <div className="bq-row-actions">
                <button
                  className="btn btn-primary"
                  aria-label={`Buy ${asset.symbol}`}
                  disabled={asset.status !== "Active"}
                  onClick={() => setTrade({ asset, side: "buy" })}
                >
                  Buy
                </button>
                {owned && (
                  <button
                    className="btn btn-secondary"
                    aria-label={`Sell ${asset.symbol}`}
                    onClick={() => setTrade({ asset, side: "sell" })}
                  >
                    Sell
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!visible.length && (
        <div className="bq-empty">
          <h2>No matching tokens</h2>
          <p>Try another name, symbol or contract address.</p>
        </div>
      )}
      <p className="bq-data-note">
        Issuer catalog · cached up to 5 minutes. Reference prices use underlying bid/ask midpoint × multiplier, not an
        executable quote. Quote generation time does not establish market freshness. Active is the asset’s catalog
        status, not confirmation that trading is open.
      </p>
    </>
  );
}
