"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { Arrow } from "~~/components/Arrow";
import { StockLogo } from "~~/components/StockLogo";
import { TokenAmount } from "~~/components/TokenAmount";
import { useWalletSession } from "~~/components/WalletAuthentication";
import { AssetDetails, type DetailAsset } from "~~/components/atlas/AssetDetails";
import { WalletWatchlist } from "~~/components/portfolio/WalletWatchlist";
import { RobinhoodBalance } from "~~/components/trading/RobinhoodBalance";
import { TradeDialog, type TradeSelection } from "~~/components/trading/TradeDialog";
import { useStockActions, useStockPortfolio } from "~~/hooks/scaffold-eth/useStockPortfolio";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
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
              View onchain update <Arrow out />
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
          How corporate events work <Arrow out />
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
  const [selectedAsset, setSelectedAsset] = useState<DetailAsset>();
  const [trade, setTrade] = useState<TradeSelection>();
  const eventsPage = page === "events";
  const { address: connectedAddress } = useAccount();
  const { authenticated } = useWalletSession();
  const { openConnectModal } = useWalletConnectModal();
  const [watchedAddress, setWatchedAddress] = useState<`0x${string}`>();
  const [search, setSearch] = useState("");
  const [chosenScope, setScope] = useState<"holdings" | "all">();
  const [eventStatus, setEventStatus] = useState("all");
  const [eventToken, setEventToken] = useState(initialToken);
  const [eventLimit, setEventLimit] = useState(20);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const address = eventsPage ? connectedAddress : (watchedAddress ?? connectedAddress);
  const walletQuery = useStockPortfolio(address);
  const ownPortfolio = useStockPortfolio(connectedAddress);
  const ownBalances = new Map(
    ownPortfolio.data?.holdings.map(holding => [holding.address.toLowerCase(), holding.balance]),
  );
  const actionsQuery = useStockActions();
  const portfolio = walletQuery.data;
  const actions = actionsQuery.data?.actions ?? [];
  const holdings = portfolio?.holdings ?? [];
  const scope = chosenScope ?? (connectedAddress && (!portfolio || holdings.length > 0) ? "holdings" : "all");
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
  const loading = authenticated && !!address && walletQuery.isPending;
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
    <div className="bq-dashboard bq-portfolio-dashboard">
      {selectedAsset && (
        <AssetDetails
          asset={selectedAsset}
          onClose={() => setSelectedAsset(undefined)}
          onTrade={selection => {
            setSelectedAsset(undefined);
            setTrade(selection);
          }}
        />
      )}
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
      <div className="bq-page-heading">
        <div>
          <h1>{eventsPage ? "Corporate events" : "Your portfolio"}</h1>
          <p>
            {eventsPage
              ? "Dividends, splits and multiplier updates across Stock Tokens."
              : "See what you hold. Understand what’s changing."}
          </p>
        </div>
        <div className="bq-heading-actions" hidden={!eventsPage && !authenticated}>
          <button
            type="button"
            aria-label={eventsPage ? "Refresh corporate events" : "Refresh portfolio and events"}
            title={eventsPage ? "Refresh corporate events" : "Refresh balances and events"}
            className="btn btn-square bq-secondary"
            disabled={walletQuery.isFetching || actionsQuery.isFetching}
            onClick={() => {
              if (authenticated && address && (!eventsPage || scope === "holdings")) void walletQuery.refetch();
              void actionsQuery.refetch();
              if (!eventsPage) void queryClient.invalidateQueries({ queryKey: ["trade-balance"] });
            }}
          >
            <ArrowPathIcon className={walletQuery.isFetching || actionsQuery.isFetching ? "bq-spinning" : ""} />
          </button>
        </div>
      </div>

      {eventsPage && (
        <section className="bq-events-intro" aria-label="About corporate events">
          <p>
            Companies sometimes pay dividends or split their shares. These events can change how much stock each Stock
            Token represents.
          </p>
          <details>
            <summary>Read more</summary>
            <p>
              <strong>Dividends</strong> are payments a company makes to shareholders. For Robinhood Stock Tokens, the
              adjustment is reflected in how much stock each token represents, rather than a cash payment to your
              wallet.
            </p>
            <p>
              <strong>Stock splits</strong> divide shares into smaller pieces. Think of cutting a pizza into more
              slices: more pieces do not mean more pizza.
            </p>
            <p>
              Your token count can stay the same. A number called the <strong>multiplier</strong> tracks how many
              underlying shares each token represents. For example, 10 tokens with a multiplier of 1.02 represent
              exposure to 10.2 shares.
            </p>
            <a
              className="link"
              href="https://docs.robinhood.com/chain/stock-tokens/#corporate-actions-the-multiplier"
              target="_blank"
              rel="noreferrer"
            >
              Robinhood documentation <Arrow out />
            </a>
          </details>
        </section>
      )}
      {(!eventsPage || scope === "holdings") && (
        <>
          <div className="bq-wallet-bar" hidden={eventsPage || !authenticated}>
            <div className="bq-wallet-label">
              <WalletIcon />
              <span>
                {watchedAddress ? "Watching wallet" : connectedAddress ? "Connected wallet" : "No wallet connected"}
              </span>
              {address && <Address address={address} chain={robinhoodChain} />}
            </div>
            <span className="bq-network">
              <span />
              Robinhood Chain · wallet balances
            </span>
          </div>

          {!eventsPage && !authenticated && (
            <div className="bq-connect-panel card">
              <div>
                <h2>A clearer view of your holdings.</h2>
                <p>
                  Sign in with your wallet to view your own or another wallet’s Stock Tokens on Robinhood Chain. No
                  transaction required.
                </p>
              </div>
              <button className="btn btn-primary" type="button" onClick={openConnectModal} disabled={!openConnectModal}>
                {connectedAddress ? (openConnectModal ? "Sign in" : "Confirm in wallet…") : "Connect wallet"}
              </button>
              <Link className="link" href="/atlas">
                Explore assets <Arrow />
              </Link>
            </div>
          )}

          {authenticated && walletQuery.isError && (
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
      {!eventsPage && authenticated && (
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
              {!!portfolio?.unpriced && (
                <div className="bq-value-bottom">{portfolio.unpriced} holding(s) without a price</div>
              )}
            </div>
            <div className="bq-portfolio-counts">
              <span>{loading ? "Loading…" : `${hasPortfolio ? holdings.length : "—"} Stock Tokens`}</span>
              <Link className="link" href="/corporate-events">
                {hasPortfolio && actionsQuery.data ? pending.length : "—"} events in progress
              </Link>
              {address && !watchedAddress && (
                <span className="bq-portfolio-funds">
                  <RobinhoodBalance address={address} />
                  <RobinhoodBalance address={address} asset="ETH" />
                </span>
              )}
            </div>
          </section>

          <section className="bq-section card" aria-labelledby="holdings-title">
            <div className="bq-section-heading">
              <div>
                <h2 id="holdings-title">
                  Your holdings{" "}
                  <span className="bq-count" role="status">
                    {loading ? "Loading…" : hasPortfolio ? holdings.length : "—"}
                  </span>
                </h2>
                <p>Token balances and their underlying share equivalents.</p>
                {loading ? (
                  <div className="skeleton bq-holdings-link-loading" aria-label="Loading holdings" />
                ) : (
                  <Link className="link" href="/atlas">
                    Buy another asset <Arrow />
                  </Link>
                )}
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
            <div className="bq-holdings-list" aria-busy={loading}>
              {loading
                ? [0, 1, 2].map(i => (
                    <div key={i} className="skeleton bq-holding-skeleton" aria-label="Loading holding" />
                  ))
                : visibleHoldings.map(holding => (
                    <div className="bq-asset-list-row bq-asset-action-row" key={holding.address}>
                      <button
                        className="bq-asset-row-details"
                        onClick={() => setSelectedAsset(holding)}
                        aria-label={`View ${holding.symbol} holding`}
                      >
                        <StockLogo symbol={holding.symbol} size={40} />
                        <span className="bq-list-identity">
                          <strong>{holding.symbol}</strong>
                          <small>
                            <TokenAmount value={holding.balance} /> tokens
                          </small>
                        </span>
                        <span className="bq-list-value">
                          <strong>{holding.valueUsd === null ? "Unavailable" : money(holding.valueUsd)}</strong>
                          <small>Reference value</small>
                        </span>
                      </button>
                      <div className="bq-row-actions">
                        <button
                          className="btn btn-primary"
                          aria-label={`Buy ${holding.symbol}`}
                          onClick={() => setTrade({ asset: holding, side: "buy" })}
                        >
                          Buy
                        </button>
                        {Number(ownBalances.get(holding.address.toLowerCase()) ?? 0) > 0 && (
                          <button
                            className="btn btn-secondary"
                            aria-label={`Sell ${holding.symbol}`}
                            onClick={() => setTrade({ asset: holding, side: "sell" })}
                          >
                            Sell
                          </button>
                        )}
                      </div>
                    </div>
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
      {authenticated && !eventsPage && (
        <details className="bq-watch-disclosure">
          <summary>{watchedAddress ? "Watching another wallet · Change" : "Watch another wallet"}</summary>
          <WalletWatchlist
            selected={watchedAddress}
            connected={connectedAddress}
            onSelect={address => {
              setWatchedAddress(address);
              setSearch("");
            }}
          />
        </details>
      )}
      {eventsPage && (
        <section className="bq-events-layout" id="corporate-events">
          <div className="bq-section card">
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
            </div>
            <details className="bq-event-filters">
              <summary>
                Filters{eventToken ? ` · ${eventToken}` : ""}
                {eventStatus !== "all" ? " · Status selected" : ""}
              </summary>
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
            </details>
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
