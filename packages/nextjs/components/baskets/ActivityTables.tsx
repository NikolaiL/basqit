"use client";

import { useState } from "react";
import { formatToken } from "~~/components/packs/usePacks";
import { explorerAddress, explorerTx } from "~~/services/packs/testnet";

export type ActivityRow = {
  at: number;
  hash: string;
  kind: "bought" | "sold" | "created" | "announced" | "rebalanced" | "cancelled" | "minted" | "redeemed";
  who: string;
  shares?: string;
  usdg?: string;
};

const LABELS: Record<ActivityRow["kind"], string> = {
  bought: "Bought",
  sold: "Sold",
  created: "Created",
  announced: "Rebalance announced",
  rebalanced: "Rebalanced",
  cancelled: "Rebalance cancelled",
  minted: "Minted in kind",
  redeemed: "Redeemed in kind",
};

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function ago(at: number, now: number) {
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const seconds = at - now;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "just now";
}

export function HoldersTable({
  holders,
  supply,
  you,
}: {
  holders: { address: string; shares: string }[];
  supply: bigint;
  you?: string;
}) {
  if (!holders.length) return <p className="bq-demo-note">No holders yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm bq-details-table">
        <thead>
          <tr>
            <th>Holder</th>
            <th>Shares</th>
            <th>Of supply</th>
          </tr>
        </thead>
        <tbody>
          {holders.map(h => {
            const mine = !!you && h.address.toLowerCase() === you.toLowerCase();
            return (
              <tr key={h.address} className={mine ? "is-you" : undefined}>
                <td>
                  <a href={explorerAddress(h.address)} target="_blank" rel="noreferrer">
                    {short(h.address)}
                  </a>
                  {mine && <span className="bq-details-you">you</span>}
                </td>
                <td>{formatToken(BigInt(h.shares), 18)}</td>
                <td>{supply ? `${((Number(BigInt(h.shares)) / Number(supply)) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const exact = (at: number) =>
  new Date(at * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ActivityTable({ rows, now }: { rows: ActivityRow[]; now: number }) {
  // Clicking any time, or the column title, switches every time between "5 minutes ago" and the exact date.
  const [absolute, setAbsolute] = useState(false);
  const toggle = () => setAbsolute(value => !value);
  if (!rows.length) return <p className="bq-demo-note">No transactions yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm bq-details-table">
        <thead>
          <tr>
            <th>What</th>
            <th>Who</th>
            <th>Shares</th>
            <th>tUSDG</th>
            <th>
              <button type="button" className="bq-time-toggle" onClick={toggle} aria-pressed={absolute}>
                When
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.hash}-${r.kind}`}>
              <td>
                <a href={explorerTx(r.hash)} target="_blank" rel="noreferrer">
                  {LABELS[r.kind]}
                </a>
              </td>
              <td>{short(r.who)}</td>
              <td>{r.shares ? formatToken(BigInt(r.shares), 18) : ""}</td>
              <td>{r.usdg ? formatToken(BigInt(r.usdg), 6) : ""}</td>
              <td>
                <button
                  type="button"
                  className="bq-time-toggle"
                  onClick={toggle}
                  title={absolute ? ago(r.at, now) : exact(r.at)}
                >
                  {absolute ? exact(r.at) : ago(r.at, now)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
