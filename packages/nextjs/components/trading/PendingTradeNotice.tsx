"use client";

import { useState } from "react";
import { Arrow } from "~~/components/Arrow";
import type { usePendingTrade } from "~~/hooks/scaffold-eth/useStockTrade";
import { robinhoodChain } from "~~/services/atlas/client";

/** Blocks a new trade while an earlier one from this wallet has no known outcome, with funding's recovery steps. */
export function PendingTradeNotice({ pending }: { pending: ReturnType<typeof usePendingTrade> }) {
  const [hash, setHash] = useState("");
  const trade = pending.data;
  if (!trade && !pending.isError) return null;
  const notSent = () => {
    if (
      window.confirm("I checked my wallet history: this trade was not sent, or its result already shows in my balance.")
    )
      pending.dismiss();
  };
  if (!trade)
    return (
      <div className="bq-fine-print" role="alert">
        <p>The saved record of an earlier trade could not be read. Check your wallet history before trading again.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={notSent}>
          I checked my wallet history
        </button>
      </div>
    );
  return (
    <div className="bq-fine-print" role="status">
      <p>
        An earlier trade from this wallet is still unresolved, so new trades are paused until it confirms or fails. This
        checks automatically.
      </p>
      {trade.ref && trade.kind === "tx" && (
        <a
          className="link"
          target="_blank"
          rel="noreferrer"
          href={`${robinhoodChain.blockExplorers.default.url}/tx/${trade.ref}`}
        >
          View transaction <Arrow out />
        </a>
      )}
      {trade.ref && trade.kind === "calls" && (
        <p>
          Submitted as one wallet batch. Reference: <code className="break-all">{trade.ref}</code>
        </p>
      )}
      {!trade.ref && (
        <>
          <p>Check your wallet history. If it was sent, paste the transaction hash to track it.</p>
          <input
            className="input input-bordered input-sm w-full"
            aria-label="Submitted trade transaction hash"
            value={hash}
            onChange={e => setHash(e.target.value)}
            placeholder="0x…"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!/^0x[0-9a-f]{64}$/i.test(hash)}
            onClick={() => pending.track(hash as `0x${string}`)}
          >
            Track transaction
          </button>
        </>
      )}
      {(!trade.ref || trade.kind === "calls") && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={notSent}>
          I checked my wallet history
        </button>
      )}
    </div>
  );
}
