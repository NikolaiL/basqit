"use client";

import { useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import { robinhoodChain } from "~~/services/atlas/client";
import { amount } from "~~/services/portfolio/format";

export type CatalogAsset = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  multiplier: string | null;
  decimals: number | null;
  isin: string | null;
  status: string;
};

export function AssetCatalog({ assets }: { assets: CatalogAsset[] }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = assets.filter(asset =>
    `${asset.symbol} ${asset.name} ${asset.address} ${asset.isin ?? ""}`.toLowerCase().includes(query),
  );
  return (
    <>
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
        {visible.map(asset => (
          <article key={asset.address} className="card bq-asset-card">
            <div className="bq-asset-heading">
              <span className="bq-asset-mark" aria-hidden="true">
                {asset.symbol.slice(0, 2)}
              </span>
              <div>
                <h2>{asset.symbol}</h2>
                <p>{asset.name}</p>
              </div>
              <span className="badge badge-outline">{asset.status}</span>
            </div>
            <div className="bq-asset-equivalent">
              <span>1 token represents</span>
              <strong title={asset.multiplier ?? undefined}>
                {asset.multiplier ? amount(asset.multiplier, 9) : "Unavailable"}
              </strong>
              <span>underlying shares · adjusts with corporate events</span>
            </div>
            <dl className="bq-asset-metadata">
              <div>
                <dt>Token decimals</dt>
                <dd>{asset.decimals ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>ISIN</dt>
                <dd>{asset.isin || "Not provided"}</dd>
              </div>
            </dl>
            <div className="bq-asset-address">
              <span>Token contract</span>
              <Address
                address={asset.address}
                chain={robinhoodChain}
                blockExplorerAddressLink={`${robinhoodChain.blockExplorers.default.url}/token/${asset.address}`}
              />
              <code>{asset.address}</code>
            </div>
            <div className="bq-asset-links">
              <a
                className="link"
                href={`${robinhoodChain.blockExplorers.default.url}/token/${asset.address}`}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer ↗
              </a>
              <Link className="link" href={`/corporate-events?token=${encodeURIComponent(asset.symbol)}`}>
                Dividend history →
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="bq-empty">
          <h2>No matching tokens</h2>
          <p>Try another name, symbol or contract address.</p>
        </div>
      )}
      <p className="bq-data-note">
        Issuer catalog · cached up to 5 minutes. Active is the asset’s catalog status, not confirmation that trading is
        open.
      </p>
    </>
  );
}
