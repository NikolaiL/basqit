"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { type Address, formatUnits } from "viem";
import { DialogClose } from "~~/components/DialogClose";
import { StockLogo } from "~~/components/StockLogo";
import { PackFace } from "~~/components/packs2/PackFace";
import { formatUsd, useUsdPrices } from "~~/components/packs/usePacks";
import { SwapConfetti } from "~~/components/trading/SwapConfetti";
import { packPresentation } from "~~/services/packs/catalog";
import { type PackPayout, payoutLevel, payoutValueUsd } from "~~/services/packs/reveal";
import { type PackStock, payoutStock } from "~~/services/packs/stocks";
import { amount as displayAmount } from "~~/services/portfolio/format";

export type RevealLevel = { end: number; token: Address; amount: bigint; name: string; color: string };
const READY_TITLE = "Your pack is ready to be revealed.";

/** Presentation only: results arrive after the reveal transaction is confirmed. */
export function PackReveal({
  id,
  quantity,
  packPrice,
  results,
  levels,
  stocks,
  waiting,
  readyToReveal = false,
  controls,
  preview = false,
  onClose,
}: {
  id?: bigint;
  quantity: number;
  packPrice?: bigint;
  results?: readonly PackPayout[];
  levels: readonly RevealLevel[];
  stocks: readonly PackStock[];
  waiting?: ReactNode;
  readyToReveal?: boolean;
  controls?: ReactNode;
  preview?: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"sealed" | "flipping" | "revealed">("sealed");
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (preview || !results?.length || autoOpened.current) return;
    autoOpened.current = true;
    setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "revealed" : "flipping");
  }, [preview, results]);
  const prize = results?.[index];
  const pack = packPresentation(packPrice);
  const level = prize && payoutLevel(levels, prize);
  const stock = prize && payoutStock(prize.token, stocks);
  const prices = useUsdPrices(stocks.map(stock => stock.ticker));
  const usdLabel = (amount: bigint, ticker: string) => {
    const value = payoutValueUsd(amount, prices.data?.[ticker]);
    return value === undefined ? "USD reference unavailable" : `${formatUsd(value)} USD reference`;
  };
  const eligibleStocks = [...new Set(levels.map(level => level.token.toLowerCase()))].map(token =>
    payoutStock(token as Address, stocks),
  );
  const show = () => {
    if (!results) return;
    setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "revealed" : "flipping");
  };
  const revealed = phase === "revealed" && !!results;
  return (
    <dialog ref={dialog} className="modal bq-pack-dialog" aria-labelledby="pack-reveal-title" onClose={onClose}>
      <div
        className="modal-box bq-pack-theatre"
        style={{ "--reveal-color": level?.color ?? "var(--bq-brand)", "--pack-color": pack.color } as CSSProperties}
      >
        <DialogClose label="Close opening" onClick={() => dialog.current?.close()} />
        <div className="bq-pack-theatre-top">
          <span className="badge badge-outline">
            {preview ? `Sample preview · ${pack.name} ${pack.label}` : `Opening #${id} · ${pack.name}`}
          </span>
          <span>
            {quantity} {quantity === 1 ? "pack" : "packs"} ·{" "}
            {packPrice === undefined ? "Test tokens" : `${formatUnits(packPrice, 6)} tUSDG each`}
          </span>
        </div>
        <h2 id="pack-reveal-title">
          <span>
            {revealed
              ? all
                ? "The whole collection."
                : "A little piece. All yours."
              : results
                ? "Good things come sealed."
                : readyToReveal
                  ? READY_TITLE
                  : "Your pack is on its way."}
          </span>
          {!preview && (
            <span className="bq-pack-title-reserve" aria-hidden="true">
              {READY_TITLE}
            </span>
          )}
        </h2>
        <div className="bq-pack-subtitle" role="status">
          {preview
            ? "Illustrative samples. No payment, selection, or tokens."
            : revealed
              ? "Result confirmed on-chain. Collect it whenever you’re ready."
              : results
                ? "Your result is fixed on-chain. The next part is just for fun."
                : readyToReveal
                  ? controls
                  : waiting}
        </div>
        <div className={`bq-pack-reveal-stage bq-pack-phase-${phase}${all ? " bq-pack-show-all" : ""}`}>
          <div className="bq-pack-orbit bq-pack-orbit-one" aria-hidden="true">
            ✦
          </div>
          <div className="bq-pack-orbit bq-pack-orbit-two" aria-hidden="true">
            ✳
          </div>
          <div className="bq-pack-orbit bq-pack-orbit-three" aria-hidden="true">
            +
          </div>
          {all && results ? (
            <div className="bq-pack-result-grid">
              {results.map((result, i) => {
                const band = payoutLevel(levels, result);
                const stock = payoutStock(result.token, stocks);
                return (
                  <div
                    key={i}
                    className="bq-pack-mini-result"
                    style={
                      {
                        "--reveal-color": band?.color ?? "var(--bq-brand)",
                        animationDelay: `${Math.min(i, 10) * 45}ms`,
                      } as CSSProperties
                    }
                  >
                    <StockLogo symbol={stock.ticker} size={32} />
                    <b>
                      Pack {i + 1} · {band?.name ?? "Stock Tokens"}
                    </b>
                    <span>
                      {displayAmount(formatUnits(result.amount, 18), 6)} t{stock.ticker}
                    </span>
                    <small>{usdLabel(result.amount, stock.ticker)}</small>
                    <small>{preview ? "Sample" : result.paid ? "Collected" : "Awaiting collection"}</small>
                  </div>
                );
              })}
            </div>
          ) : (
            <div key={index} className="bq-pack-result" aria-label={revealed ? `Pack ${index + 1} result` : undefined}>
              <div
                className="bq-pack-result-card"
                onAnimationEnd={event => {
                  if (event.target === event.currentTarget && event.animationName === "bq-pack-flip")
                    setPhase("revealed");
                }}
              >
                <div className="bq-pack-result-face bq-pack-result-back" aria-hidden={revealed}>
                  <button
                    className="bq-pack-wrapper"
                    disabled={!results || phase !== "sealed"}
                    onClick={show}
                    aria-label={results ? "Flip pack and reveal card" : "Waiting for confirmed result"}
                  >
                    <span className="bq-pack-tear-strip">A LITTLE POSSIBILITY. FLIP TO REVEAL ↗</span>
                    <span className="bq-pack-wrapper-body">
                      <PackFace pack={pack} stocks={eligibleStocks} />
                    </span>
                  </button>
                </div>
                {prize && (
                  <div className="bq-pack-result-face bq-pack-result-front" aria-hidden={!revealed}>
                    <div className="bq-pack-card-heading">
                      <span>STOCK TOKEN</span>
                      <b>{level?.name ?? "Stock Tokens"}</b>
                    </div>
                    <StockLogo symbol={stock!.ticker} size={88} />
                    <strong>{stock!.ticker}</strong>
                    <span className="bq-pack-card-company">A piece of {stock!.company}</span>
                    <div className="bq-pack-card-amount">
                      <b>
                        {displayAmount(formatUnits(prize.amount, 18), 6)} t{stock!.ticker}
                      </b>
                      <span>{usdLabel(prize.amount, stock!.ticker)}</span>
                    </div>
                    <div className="bq-pack-card-footer">
                      <span>{preview ? "SAMPLE CARD" : `NUMBER ${prize.slot} / 999`}</span>
                      <b>basqit.</b>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {results && (preview || revealed) && (
          <div className="bq-pack-theatre-actions">
            {!revealed ? (
              <>
                <button className="btn btn-primary" onClick={show} disabled={phase === "flipping"}>
                  {phase === "flipping" ? "Revealing…" : "Flip to reveal ↗"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAll(true);
                    setPhase("revealed");
                  }}
                >
                  Skip animation · Show all
                </button>
              </>
            ) : (
              <>
                {!all && (
                  <p className="bq-pack-progress">
                    {index + 1} of {results.length} · {level?.name ?? "Stock Tokens"}
                  </p>
                )}
                {!all && index + 1 < results.length && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setIndex(index + 1);
                      show();
                    }}
                  >
                    Next card →
                  </button>
                )}
                {!all && results.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
                    Show all {results.length} cards
                  </button>
                )}
                {controls}
                {preview && (
                  <button className="btn btn-primary" onClick={() => dialog.current?.close()}>
                    Nice. Back to packs.
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <p className="bq-pack-theatre-note">
          {preview
            ? "Sample cards demonstrate the animation, not the payout distribution."
            : "You can close this window and resume from Your openings. Animation never changes a result."}
        </p>
      </div>
      {revealed && (
        <SwapConfetti
          key={all ? "all" : index}
          symbols={
            all ? [...new Set(results!.map(result => payoutStock(result.token, stocks).ticker))] : [stock!.ticker]
          }
        />
      )}
    </dialog>
  );
}
