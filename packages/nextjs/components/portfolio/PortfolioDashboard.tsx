"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Address } from "@scaffold-ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { StockLogo } from "~~/components/StockLogo";
import { TokenAmount } from "~~/components/TokenAmount";
import { WalletWatchlist } from "~~/components/portfolio/WalletWatchlist";
import { TradeDialog, type TradeSelection } from "~~/components/trading/TradeDialog";
import { USDGBalance } from "~~/components/trading/USDGBalance";
import { useStockActions, useStockPortfolio } from "~~/hooks/scaffold-eth/useStockPortfolio";
import { robinhoodChain } from "~~/services/atlas/client";
import { amount, dividendHistory, money } from "~~/services/portfolio/format";
import type { CorporateAction } from "~~/services/portfolio/types";

const dateLabel = (date: string | null) =>
  date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Date not scheduled";
const typeLabel = (type: string) =>
  ({
    CORPORATE_ACTION_TYPE_CASH_DIVIDEND: "Cash dividend",
    CORPORATE_ACTION_TYPE_STOCK_DIVIDEND: "Stock dividend",
    CORPORATE_ACTION_TYPE_FORWARD_SPLIT: "Stock split",
    CORPORATE_ACTION_TYPE_REVERSE_SPLIT: "Reverse split",
  })[type] ?? "Corporate event";

function EventRow({ event }: { event: CorporateAction }) {
  const completed = event.status === "CORPORATE_ACTION_STATUS_COMPLETED";
  const pending = event.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS";
  return (
    <details className="bq-event">
      <summary>
        <span className="bq-event-date">
          <CalendarDaysIcon />
          <span>{dateLabel(event.date)}</span>
        </span>
        <span className="bq-event-main">
          <strong>{event.symbol}</strong>
          <span>{typeLabel(event.type)}</span>
        </span>
        <span className={`badge bq-status ${completed ? "bq-status-done" : ""}`}>
          {completed ? "Processed" : pending ? "In progress" : "Status unavailable"}
        </span>
        <span className="bq-event-rate">
          {event.rate
            ? event.type === "CORPORATE_ACTION_TYPE_CASH_DIVIDEND"
              ? `$${amount(event.rate, 6)} / share`
              : `${amount(event.rate, 6)} shares / share`
            : event.oldRate && event.newRate
              ? `${event.oldRate} : ${event.newRate}`
              : "Details"}
        </span>
        <span className="bq-expand" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="bq-event-detail">
        {pending ? (
          <>
            <dl className="bq-multiplier-change" aria-label={`${event.symbol} multiplier outlook`}>
              <div>
                <dt>Current multiplier</dt>
                <dd>{event.projection?.current ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>
                  {event.projection?.source === "issuer"
                    ? "Announced token multiplier"
                    : "Estimated multiplier · approximate"}
                </dt>
                <dd>
                  {event.projection
                    ? `${event.projection.source === "estimate" ? "≈ " : ""}${amount(event.projection.after, 9)}`
                    : "Awaiting announcement"}
                </dd>
              </div>
            </dl>
            {event.projection?.source === "estimate" ? (
              <>
                <p>
                  <strong>Illustrative estimate, not an issuer forecast or a guaranteed payout.</strong>
                </p>
                <p className="bq-fine-print">
                  Shares per token, assuming this dividend is fully reinvested at the quoted price. Each event is
                  estimated separately from the current multiplier; estimates are not cumulative. The actual result may
                  differ due to execution price, deductions, rounding or other adjustments.
                </p>
                <p className="bq-fine-print">
                  Formula: current multiplier × (1 + dividend per share / share price). Reference share price: $
                  {event.projection.price} (bid/ask midpoint). Quote: {event.projection.priceAt}. This is a snapshot and
                  may be stale outside trading hours.
                </p>
              </>
            ) : event.projection?.source === "issuer" ? (
              <p className="bq-fine-print">
                Shares per token. Announced by the issuer for this token, effective {event.projection.effectiveAt}. The
                feed does not explicitly link this schedule to this corporate event. Scheduled values may change.
              </p>
            ) : (
              <p className="bq-fine-print">No announced multiplier or usable estimate is available for this event.</p>
            )}
          </>
        ) : (
          <>
            <dl className="bq-multiplier-change" aria-label={`${event.symbol} event multiplier change`}>
              <div>
                <dt>Multiplier before</dt>
                <dd>
                  {event.multiplierBefore ?? (event.onchain?.status === "unmatched" ? "Not matched" : "Unavailable")}
                </dd>
              </div>
              <div>
                <dt>{pending ? "Scheduled multiplier after" : "Multiplier after"}</dt>
                <dd>
                  {event.multiplierAfter ?? (event.onchain?.status === "unmatched" ? "Not matched" : "Unavailable")}
                </dd>
              </div>
            </dl>
            <p className="bq-fine-print">
              Shares per token.{" "}
              {event.multiplierBefore === null || event.multiplierAfter === null
                ? event.onchain?.status === "unmatched"
                  ? "No unique onchain update could be matched to this event. This does not mean the multiplier stayed unchanged."
                  : "Onchain history is currently unavailable. The current multiplier is not a historical value."
                : pending
                  ? "Scheduled values may change before processing."
                  : event.onchain?.status === "correlated"
                    ? "Exact onchain values. Matched by token contract and effective date within three calendar days of the processing date; the issuer does not provide a shared event ID. This association is inferred."
                    : "Multiplier values for this event."}
            </p>
          </>
        )}
        {event.onchain?.status === "correlated" && (
          <p className="bq-fine-print">
            Effective: {event.onchain.effectiveAt} · Block {event.onchain.blockNumber}.{" "}
            <a
              className="link"
              href={`https://robinhoodchain.blockscout.com/tx/${event.onchain.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View onchain update ↗
            </a>
          </p>
        )}
        {event.rate !== null && (
          <p>
            <strong>
              Reported rate:{" "}
              {event.type === "CORPORATE_ACTION_TYPE_CASH_DIVIDEND"
                ? `$${event.rate} USD per underlying share`
                : `${event.rate} shares per underlying share`}
            </strong>
          </p>
        )}
        <p>
          {completed
            ? "The issuer marks this event as processed."
            : pending
              ? "The issuer is processing this event. Its date or status may change."
              : "The issuer has not provided a recognized processing status."}{" "}
          The date shown is the processing date, not a cash payment date.
        </p>
        <p>
          Stock Token adjustments are reflected in the shares-per-token multiplier. This event is not a USDG payment to
          your wallet, and a current holding does not establish entitlement on a past record date.
        </p>
        <a className="link" href="https://docs.robinhood.com/chain/stock-token-apis/" target="_blank" rel="noreferrer">
          How corporate events work ↗
        </a>
      </div>
    </details>
  );
}

export function PortfolioDashboard({
  page = "portfolio",
  initialToken = "",
}: {
  page?: "portfolio" | "events";
  initialToken?: string;
}) {
  const queryClient = useQueryClient();
  const [trade, setTrade] = useState<TradeSelection>();
  const eventsPage = page === "events";
  const { address: connectedAddress } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [watchedAddress, setWatchedAddress] = useState<`0x${string}`>();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"holdings" | "all">(eventsPage ? "all" : "holdings");
  const [eventStatus, setEventStatus] = useState("all");
  const [eventToken, setEventToken] = useState(initialToken);
  const [eventLimit, setEventLimit] = useState(20);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const address = watchedAddress ?? connectedAddress;
  const walletQuery = useStockPortfolio(!eventsPage || scope === "holdings" ? address : undefined);
  const actionsQuery = useStockActions();
  const portfolio = walletQuery.data;
  const actions = actionsQuery.data?.actions ?? [];
  const holdings = portfolio?.holdings ?? [];
  const symbols = new Set(holdings.map(h => h.symbol));
  const visibleHoldings = holdings.filter(h => `${h.symbol} ${h.name}`.toLowerCase().includes(search.toLowerCase()));
  const tokenOptions = [
    ...new Set([...holdings.map(h => h.symbol), ...actions.map(a => a.symbol), ...(eventToken ? [eventToken] : [])]),
  ].sort();
  const scopedEvents = eventToken
    ? dividendHistory(actions, eventToken)
    : actions.filter(event => scope === "all" || symbols.has(event.symbol));
  const events = scopedEvents.filter(event => eventStatus === "all" || event.status === eventStatus);
  const relevantEvents = actions.filter(event => symbols.has(event.symbol));
  const pending = relevantEvents.filter(event => event.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS");
  const loading = !!address && walletQuery.isPending;
  const hasPortfolio = !!portfolio;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!eventsPage || !target || eventLimit >= events.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          setEventLimit(limit => Math.min(limit + 20, events.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [eventsPage, eventLimit, events.length, eventToken, eventStatus, scope]);

  return (
    <div className="bq-dashboard">
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
      <div className="bq-page-heading">
        <div>
          <div className="bq-eyebrow">YOUR STOCK TOKENS, IN ONE PLACE</div>
          <h1>{eventsPage ? "Corporate events" : "Your portfolio"}</h1>
          <p>
            {eventsPage
              ? "Dividends, splits and multiplier updates across Stock Tokens."
              : "See what you hold. Understand what’s changing."}
          </p>
        </div>
        <div className="bq-heading-actions">
          <button
            type="button"
            aria-label={eventsPage ? "Refresh corporate events" : "Refresh portfolio and events"}
            title={eventsPage ? "Refresh corporate events" : "Refresh balances and events"}
            className="btn btn-square bq-secondary"
            disabled={walletQuery.isFetching || actionsQuery.isFetching}
            onClick={() => {
              if (address && (!eventsPage || scope === "holdings")) void walletQuery.refetch();
              void actionsQuery.refetch();
              if (!eventsPage) void queryClient.invalidateQueries({ queryKey: ["trade-balance"] });
            }}
          >
            <ArrowPathIcon className={walletQuery.isFetching || actionsQuery.isFetching ? "bq-spinning" : ""} />
          </button>
        </div>
      </div>

      {(!eventsPage || scope === "holdings") && (
        <>
          <div className="bq-wallet-bar">
            <div className="bq-wallet-label">
              <WalletIcon />
              <span>
                {watchedAddress ? "Watching wallet" : connectedAddress ? "Connected wallet" : "No wallet connected"}
              </span>
              {address && <Address address={address} chain={robinhoodChain} />}
              {address && !eventsPage && <USDGBalance address={address} />}
            </div>
            <span className="bq-network">
              <span />
              Robinhood Chain · wallet balances
            </span>
          </div>

          {!address && (
            <div className="bq-connect-panel card">
              <div>
                <h2>A clearer view of your holdings.</h2>
                <p>Connect your wallet to read its Stock Token balances. No signature or transaction required.</p>
              </div>
              <button className="btn btn-primary" type="button" onClick={openConnectModal}>
                Connect wallet
              </button>
            </div>
          )}

          <WalletWatchlist
            selected={watchedAddress}
            connected={connectedAddress}
            onSelect={address => {
              setWatchedAddress(address);
              setSearch("");
            }}
          />

          {walletQuery.isError && (
            <div role="alert" className="alert bq-error">
              <span>{walletQuery.error.message}</span>
              <button
                className="btn btn-sm"
                disabled={walletQuery.isFetching}
                onClick={() => void walletQuery.refetch()}
              >
                Try again
              </button>
            </div>
          )}
          {portfolio && portfolio.failed > 0 && (
            <div role="status" className="alert bq-warning">
              Partial snapshot: {portfolio.failed} asset reads were unavailable. Missing balances are not treated as
              zero.
            </div>
          )}
        </>
      )}
      {!eventsPage && (
        <>
          <section className="bq-overview" aria-label="Portfolio overview">
            <div className="bq-value-card">
              <div className="bq-card-label">
                {portfolio && (portfolio.unpriced > 0 || portfolio.failed > 0)
                  ? "Available reference value"
                  : "Reference portfolio value"}
                <InformationCircleIcon />
              </div>
              <div className="bq-total" aria-live="polite">
                {loading ? (
                  <span className="skeleton bq-total-skeleton" />
                ) : hasPortfolio &&
                  (holdings.some(h => h.valueUsd !== null) || (!holdings.length && !portfolio.failed)) ? (
                  money(portfolio.totalUsd)
                ) : (
                  "—"
                )}
              </div>
              <p>Indicative value · not a sell quote</p>
              <div className="bq-value-bottom">
                <span className="bq-dot" />
                {portfolio?.unpriced
                  ? `${portfolio.unpriced} holding(s) without a price`
                  : "Your assets stay in your wallet"}
              </div>
            </div>
            <div className="bq-stat-card card">
              <span className="bq-stat-icon">
                <Squares2X2Icon />
              </span>
              <div className="bq-card-label">Stock Tokens held</div>
              <strong>{loading ? "…" : hasPortfolio ? holdings.length.toString().padStart(2, "0") : "—"}</strong>
              <p>{hasPortfolio ? "Distinct assets in this wallet" : "Connect to see your assets"}</p>
            </div>
            <div className="bq-stat-card card">
              <span className="bq-stat-icon bq-stat-warm">
                <CalendarDaysIcon />
              </span>
              <div className="bq-card-label">Events in progress</div>
              <strong>{hasPortfolio && actionsQuery.data ? pending.length.toString().padStart(2, "0") : "—"}</strong>
              <p>For your current holdings</p>
            </div>
          </section>

          <section className="bq-section card" aria-labelledby="holdings-title">
            <div className="bq-section-heading">
              <div>
                <h2 id="holdings-title">
                  Your holdings <span className="bq-count">{holdings.length}</span>
                </h2>
                <p>Token balances and their underlying share equivalents.</p>
                <Link className="link" href="/atlas">
                  Buy another asset →
                </Link>
              </div>
              <label className="input bq-search">
                <MagnifyingGlassIcon />
                <input
                  aria-label="Search holdings"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Find a holding"
                />
              </label>
            </div>
            <div className="bq-table-scroll bq-holdings-desktop">
              <table className="table bq-holdings-table">
                <thead>
                  <tr>
                    <th>ASSET</th>
                    <th>TOKEN BALANCE</th>
                    <th>SHARE EQUIVALENT</th>
                    <th>REFERENCE VALUE</th>
                    <th>DIVIDENDS</th>
                    <th>TRADE</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [0, 1, 2].map(i => (
                        <tr key={i}>
                          <td colSpan={6}>
                            <div className="skeleton bq-row-skeleton" />
                          </td>
                        </tr>
                      ))
                    : visibleHoldings.map(holding => (
                        <tr key={holding.address}>
                          <td>
                            <div className="bq-asset">
                              <StockLogo symbol={holding.symbol} />
                              <div>
                                <strong>{holding.symbol}</strong>
                                <span>{holding.name}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <strong>
                              <TokenAmount value={holding.balance} />
                            </strong>
                            <span className="bq-cell-sub">tokens</span>
                          </td>
                          <td>
                            <strong>
                              <TokenAmount value={holding.shareEquivalent} />
                            </strong>
                            <span className="bq-cell-sub">
                              {holding.multiplier ? `× ${amount(holding.multiplier, 6)}` : "Multiplier unavailable"}
                            </span>
                          </td>
                          <td>
                            <strong>{holding.valueUsd === null ? "Unavailable" : money(holding.valueUsd)}</strong>
                            <span className="bq-cell-sub">
                              {holding.priceAt
                                ? `Data ${new Date(holding.priceAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                : "No reference price"}
                            </span>
                          </td>
                          <td>
                            <Link
                              className="link bq-dividend-link"
                              href={`/corporate-events?token=${encodeURIComponent(holding.symbol)}`}
                              aria-label={`View ${holding.symbol} dividend history`}
                            >
                              Dividend history
                            </Link>
                            <span className="bq-cell-sub">
                              {!actionsQuery.data
                                ? "Awaiting event data"
                                : `${dividendHistory(actions, holding.symbol).length} reported`}
                            </span>
                          </td>
                          <td>
                            <div className="bq-trade-buttons">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => setTrade({ asset: holding, side: "buy" })}
                              >
                                Buy
                              </button>
                              <button
                                className="btn btn-sm bq-secondary"
                                onClick={() => setTrade({ asset: holding, side: "sell" })}
                              >
                                Sell
                              </button>
                            </div>
                            <Link
                              className="link bq-cell-sub"
                              href={`/discover?similar=${encodeURIComponent(holding.symbol)}`}
                            >
                              Find similar stocks →
                            </Link>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="bq-holdings-cards">
              {loading
                ? [0, 1, 2].map(i => (
                    <div key={i} className="skeleton bq-holding-skeleton" aria-label="Loading holding" />
                  ))
                : visibleHoldings.map(holding => (
                    <article className="bq-holding-card" key={holding.address} aria-label={`${holding.symbol} holding`}>
                      <div className="bq-asset">
                        <StockLogo symbol={holding.symbol} />
                        <div>
                          <strong>{holding.symbol}</strong>
                          <span>{holding.name}</span>
                        </div>
                      </div>
                      <dl className="bq-holding-metrics">
                        <div>
                          <dt>Token balance</dt>
                          <dd>
                            <TokenAmount value={holding.balance} />
                            <span className="bq-cell-sub">tokens</span>
                          </dd>
                        </div>
                        <div>
                          <dt>Share equivalent</dt>
                          <dd>
                            <TokenAmount value={holding.shareEquivalent} />
                            <span className="bq-cell-sub">
                              {holding.multiplier ? `× ${amount(holding.multiplier, 6)}` : "Multiplier unavailable"}
                            </span>
                          </dd>
                        </div>
                        <div className="bq-holding-value">
                          <dt>Reference value</dt>
                          <dd>
                            {holding.valueUsd === null ? "Unavailable" : money(holding.valueUsd)}
                            <span className="bq-cell-sub">
                              {holding.priceAt
                                ? `Data ${new Date(holding.priceAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                : "No reference price"}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      <div className="bq-holding-history">
                        <Link
                          className="link bq-dividend-link"
                          href={`/corporate-events?token=${encodeURIComponent(holding.symbol)}`}
                          aria-label={`View ${holding.symbol} dividend history`}
                        >
                          Dividend history
                        </Link>
                        <span className="bq-cell-sub">
                          {!actionsQuery.data
                            ? "Awaiting event data"
                            : `${dividendHistory(actions, holding.symbol).length} reported`}
                        </span>
                      </div>
                      <div className="bq-trade-buttons">
                        <button className="btn btn-primary" onClick={() => setTrade({ asset: holding, side: "buy" })}>
                          Buy
                        </button>
                        <button className="btn bq-secondary" onClick={() => setTrade({ asset: holding, side: "sell" })}>
                          Sell
                        </button>
                      </div>
                      <Link className="link" href={`/discover?similar=${encodeURIComponent(holding.symbol)}`}>
                        Find similar stocks →
                      </Link>
                    </article>
                  ))}
            </div>
            {!loading && visibleHoldings.length === 0 && (
              <div className="bq-empty">
                <WalletIcon />
                <h3>
                  {search
                    ? "No matching holdings"
                    : hasPortfolio
                      ? portfolio.failed
                        ? "Some balances could not be read"
                        : "No Stock Tokens found"
                      : "Your holdings will appear here"}
                </h3>
                <p>
                  {search
                    ? "Try another company name or ticker."
                    : hasPortfolio
                      ? "This view checks the issuer’s Stock Token catalog on Robinhood Chain."
                      : "Connect a wallet or look up an address."}
                </p>
              </div>
            )}
            <div className="bq-section-foot">
              <InformationCircleIcon />
              <span>
                One token may represent more or less than one underlying share. The multiplier reflects corporate
                adjustments.
              </span>
            </div>
          </section>
        </>
      )}
      {eventsPage && (
        <section className="bq-events-layout" id="corporate-events">
          <div className="bq-section card">
            <div className="bq-section-heading">
              <div>
                <h2>{eventToken ? `${eventToken} dividend history` : "Corporate events"}</h2>
                <p>
                  {eventToken
                    ? "Reported dividend events, newest processing date first."
                    : "Dividends, splits and updates to your Stock Tokens."}
                </p>
              </div>
              <DocumentTextIcon className="bq-section-symbol" />
            </div>
            <div className="bq-event-controls">
              <div className="tabs bq-tabs" role="group" aria-label="Event scope">
                <button
                  type="button"
                  className={`tab ${!eventToken && scope === "holdings" ? "tab-active" : ""}`}
                  aria-pressed={!eventToken && scope === "holdings"}
                  onClick={() => {
                    setScope("holdings");
                    setEventToken("");
                    setEventLimit(20);
                  }}
                >
                  My holdings
                </button>
                <button
                  type="button"
                  className={`tab ${!eventToken && scope === "all" ? "tab-active" : ""}`}
                  aria-pressed={!eventToken && scope === "all"}
                  onClick={() => {
                    setScope("all");
                    setEventToken("");
                    setEventLimit(20);
                  }}
                >
                  All Stock Tokens
                </button>
              </div>
              <select
                className="select bq-event-select"
                aria-label="Filter event status"
                value={eventStatus}
                onChange={e => {
                  setEventStatus(e.target.value);
                  setEventLimit(20);
                }}
              >
                <option value="all">All statuses</option>
                <option value="CORPORATE_ACTION_STATUS_IN_PROGRESS">In progress</option>
                <option value="CORPORATE_ACTION_STATUS_COMPLETED">Processed</option>
              </select>
            </div>
            <div className="bq-dividend-filter">
              <label htmlFor="dividend-token">Dividend history by token</label>
              <select
                id="dividend-token"
                className="select"
                value={eventToken}
                onChange={e => {
                  setEventToken(e.target.value);
                  setEventStatus("all");
                  setEventLimit(20);
                }}
              >
                <option value="">All corporate events</option>
                {tokenOptions.map(symbol => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </div>
            {eventToken && (
              <p className="bq-history-note">
                Available issuer records; a complete historical archive is not guaranteed. Rates are per underlying
                share, not your wallet payout. In-progress events are not completed distributions.
              </p>
            )}
            {actionsQuery.isError ? (
              <div role="alert" className="bq-empty">
                <p>{actionsQuery.error.message}</p>
                <button className="btn btn-sm" onClick={() => void actionsQuery.refetch()}>
                  Retry events
                </button>
              </div>
            ) : actionsQuery.isPending ? (
              <div className="bq-empty" role="status">
                Loading issuer events…
              </div>
            ) : events.length ? (
              <div>
                {events.slice(0, eventLimit).map(event => (
                  <EventRow key={`${event.id}-${event.symbol}-${event.type}-${event.date}`} event={event} />
                ))}
                {events.length > eventLimit && (
                  <button
                    ref={loadMoreRef}
                    className="btn btn-ghost bq-load-more"
                    onClick={() => setEventLimit(n => n + 20)}
                  >
                    Show more events ({events.length - eventLimit})
                  </button>
                )}
              </div>
            ) : (
              <div className="bq-empty">
                <CalendarDaysIcon />
                <h3>
                  {eventToken
                    ? `No reported dividends for ${eventToken} in this view`
                    : scope === "holdings" && !hasPortfolio
                      ? "Events that matter to you"
                      : "No events in this view"}
                </h3>
                <p>
                  {eventToken
                    ? "Try all statuses. No records returned does not prove that the token has never had a dividend."
                    : scope === "holdings" && !hasPortfolio
                      ? "Connect your wallet, or browse events for all Stock Tokens."
                      : "Try all statuses or browse the full asset catalog."}
                </p>
              </div>
            )}
          </div>
          <aside className="bq-explainer card">
            <span className="bq-explainer-icon">
              <InformationCircleIcon />
            </span>
            <div className="bq-eyebrow">A LITTLE CLARITY</div>
            <h2>
              Same tokens.
              <br />
              Updated share exposure.
            </h2>
            <p>
              A dividend or split can change how many underlying shares a token represents. Your token count can stay
              the same.
            </p>
            <div className="bq-formula">
              <span>Token balance</span>
              <b>×</b>
              <span>Shares per token</span>
              <hr />
              <strong>Share equivalent</strong>
            </div>
            <p className="bq-fine-print">
              An issuer event is not a cash deposit into your wallet. Processing dates are not payment dates.
            </p>
            <a
              className="link"
              href="https://docs.robinhood.com/chain/building-with-stock-tokens/"
              target="_blank"
              rel="noreferrer"
            >
              Read about adjustments ↗
            </a>
          </aside>
        </section>
      )}
      <div className="bq-data-note">
        {portfolio
          ? `Balances at block ${portfolio.blockNumber} · ${portfolio.scanned} assets checked · Updated ${new Date(portfolio.fetchedAt).toLocaleTimeString()}`
          : "Balances are read from Robinhood Chain. Corporate events come from the issuer’s public API."}{" "}
        {portfolio && "Reference prices are separate snapshots, not executable quotes."}
      </div>
    </div>
  );
}
