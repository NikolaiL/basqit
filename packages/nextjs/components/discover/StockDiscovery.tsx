"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./discovery.css";
import { ShareIcon } from "@heroicons/react/24/outline";
import { useMiniapp } from "~~/components/MiniappProvider";
import { StockLogo } from "~~/components/StockLogo";
import { AssetDetails } from "~~/components/atlas/AssetDetails";
import { BatchBuyDialog } from "~~/components/trading/BatchBuyDialog";
import { TradeDialog, type TradeSelection } from "~~/components/trading/TradeDialog";
import { trackDiscovery } from "~~/services/analytics/events";
import type { DiscoveryAsset } from "~~/services/discover/catalog";
import { type DiscoveryMatch, normalizeTheme } from "~~/services/discover/matching";
import { surpriseIdeas } from "~~/services/discover/prompts";
import { discoveryPath } from "~~/services/discover/share";

const noSharedSymbols: string[] = [];
const ideas = ["AI Companies", "Tech Giants", "Biotech", "Semiconductors", "Clean Energy", "Space & Satellites"];

export function StockDiscovery({
  assets,
  initialTheme,
  similar,
  sharedSymbols = noSharedSymbols,
}: {
  assets: DiscoveryAsset[];
  initialTheme: string;
  similar?: string;
  sharedSymbols?: string[];
}) {
  const { isMiniApp, composeCast, openLink } = useMiniapp();
  const [theme, setTheme] = useState(initialTheme);
  const [result, setResult] = useState<{ theme: string; matches: DiscoveryMatch[] }>(() => ({
    theme: normalizeTheme(initialTheme) ?? "",
    matches: sharedSymbols
      .filter(symbol => assets.some(asset => asset.symbol === symbol))
      .map(symbol => ({ symbol, score: 0 })),
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [trade, setTrade] = useState<TradeSelection>();
  const [buyList, setBuyList] = useState<DiscoveryAsset[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  const entryMethod = useRef(initialTheme ? "shared_link" : "typed");
  const sharedTracked = useRef(false);
  const shareVariant = useRef<number | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const query = normalizeTheme(theme);
  const matches = result?.theme === query ? result.matches : [];
  const matchSymbols = matches.map(match => match.symbol).join(",");
  const dragQuery = useRef(query);
  useEffect(() => {
    dragQuery.current = query;
  }, [query]);
  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | undefined;
    void import("~~/services/discover/pilePhysics").then(({ attachPilePhysics }) => {
      if (!stopped && scene.current)
        cleanup = attachPilePhysics(scene.current, coin =>
          trackDiscovery("token_drag", dragQuery.current ?? "", { symbol: coin.dataset.symbol }),
        );
    });
    return () => {
      stopped = true;
      cleanup?.();
    };
  }, []);
  const source = theme === initialTheme ? similar : undefined;
  const current = assets.find(asset => asset.symbol === selected);

  useEffect(() => {
    setError("");
    setShareStatus("");
    setSelected(undefined);
    if (!query) {
      setLoading(false);
      window.history.replaceState(null, "", discoveryPath("", []));
      return;
    }
    if (query === normalizeTheme(initialTheme) && sharedSymbols.length && retry === 0) {
      if (!sharedTracked.current) {
        trackDiscovery("shared_open", query, { stocks: sharedSymbols.join(","), result_count: sharedSymbols.length });
        sharedTracked.current = true;
      }
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const entry = entryMethod.current;
      trackDiscovery("search", query, { entry_method: entry, retry_count: retry });
      try {
        const response = await fetch(
          `/api/discover?theme=${encodeURIComponent(query)}${source ? `&similar=${encodeURIComponent(source)}` : ""}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not match this idea.");
        if (!controller.signal.aborted) {
          setResult({ theme: query, matches: body.matches });
          window.history.replaceState(
            null,
            "",
            discoveryPath(
              query,
              body.matches.map((match: DiscoveryMatch) => match.symbol),
              source,
            ),
          );
          trackDiscovery("results", query, {
            entry_method: entry,
            result_count: body.matches.length,
            stocks: body.matches.map((match: DiscoveryMatch) => match.symbol).join(","),
          });
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Try another idea.");
          trackDiscovery("error", query, { entry_method: entry });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, retry, source, initialTheme, sharedSymbols]);

  async function share(target: "x" | "farcaster" | "system") {
    if (!query) return;
    trackDiscovery("share", query, { method: target, stocks: matchSymbols });
    const url = new URL(
      discoveryPath(
        query,
        matches.map(match => match.symbol),
        source,
      ),
      window.location.origin,
    );
    shareVariant.current =
      shareVariant.current === null ? Math.floor(Math.random() * 4) : (shareVariant.current + 1) % 4;
    url.searchParams.set("layout", String(shareVariant.current));
    const text = `My stock mood: “${query}”${matches.length ? ` — ${matches.map(match => match.symbol).join(", ")}` : ""}. What’s yours?`;
    if (target === "x") {
      const intent = new URL("https://x.com/intent/post");
      intent.searchParams.set("text", `${text}\n\nbasqit by @NikolaiLeb`);
      intent.searchParams.set("url", url.href);
      await openLink(intent.href);
      return;
    }
    try {
      if (target === "farcaster") await composeCast({ text: `${text}\n\nbasqit by @nikolaii.eth`, embeds: [url.href] });
      else if (navigator.share) await navigator.share({ title: "My stock mood · Basqit", text, url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        setShareStatus("Link copied");
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError"))
        setShareStatus("Could not share. Copy the theme and try again.");
    }
  }

  return (
    <main className="bq-discover">
      <div className="bq-discover-heading">
        <span className="bq-eyebrow">A LITTLE CURIOSITY. A WHOLE MARKET.</span>
        <h1>
          Find your <em>stock mood.</em>
        </h1>
      </div>
      <section className="bq-discover-playground" aria-label="Explore Stock Tokens by theme">
        <div className="bq-discover-input">
          <span aria-hidden="true">✳</span>
          <input
            aria-label="Your stock theme"
            placeholder="Drop an idea. Watch the stocks click."
            value={theme}
            maxLength={180}
            onChange={event => {
              entryMethod.current = "typed";
              setTheme(event.target.value);
            }}
          />
          {theme && (
            <button
              className="btn btn-ghost btn-circle"
              aria-label="Clear theme"
              onClick={() => {
                trackDiscovery("clear", theme);
                setTheme("");
              }}
            >
              ×
            </button>
          )}
        </div>
        <div className="bq-discover-prompts">
          {ideas.map(idea => (
            <button
              key={idea}
              onClick={() => {
                entryMethod.current = "preset";
                trackDiscovery("preset", idea);
                setTheme(idea);
              }}
            >
              {idea}
            </button>
          ))}
          <button
            onClick={() => {
              const options = surpriseIdeas.filter(idea => idea !== theme);
              const idea = options[Math.floor(Math.random() * options.length)];
              entryMethod.current = "surprise";
              trackDiscovery("surprise", idea);
              setTheme(idea);
            }}
          >
            ✦ Surprise me
          </button>
        </div>
        <div className="bq-discover-status" role="status" aria-live="polite">
          {error ||
            (loading
              ? "Finding stocks for your idea…"
              : query && result?.theme === query
                ? matches.length
                  ? `${matches.length} connections. Tap a logo to take a closer look.`
                  : "No strong connections yet. Try a founder, a vibe, a product or a logo color."
                : `${assets.length} little possibilities. One big idea.`)}
          {error && (
            <button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}>
              Retry
            </button>
          )}
        </div>
        <div ref={scene} className={`bq-discover-scene ${loading ? "is-thinking" : ""}`} aria-busy={loading}>
          <div className="bq-discover-touch-zone" aria-hidden="true" />
          {loading && (
            <div className="bq-discover-loading" aria-hidden="true">
              <span className="bq-discover-loading-orbit">
                <span>✳</span>
              </span>
            </div>
          )}
          {!matches.length && !loading && <span className="bq-discover-shelf">LET CURIOSITY DO THE SORTING</span>}
          {assets.map(asset => {
            const rank = matches.findIndex(match => match.symbol === asset.symbol);
            const matched = rank >= 0;
            const rowSize = Math.min(4, matches.length - Math.floor(rank / 4) * 4);
            const style = {
              "--match-x": `${((rank + 0.5) * 100) / Math.max(matches.length, 1)}%`,
              "--mobile-x": `${((rank % 4) + 0.5 + (4 - rowSize) / 2) * 25}%`,
              "--mobile-y": `${Math.floor(rank / 4) * 76 + 26}px`,
              zIndex: matched ? 3 : 1,
            } as CSSProperties;
            return (
              <button
                key={asset.symbol}
                data-symbol={asset.symbol}
                className={`bq-discover-coin ${matched ? "is-match" : ""}`}
                style={style}
                title={`${asset.symbol} · ${asset.name}`}
                aria-label={`Explore ${asset.symbol}, ${asset.name}`}
                onClick={() => {
                  trackDiscovery("token_open", query ?? "", { symbol: asset.symbol, matched });
                  setSelected(asset.symbol);
                }}
              >
                <StockLogo symbol={asset.symbol} size={46} />
                <span className="bq-discover-ticker">{asset.symbol}</span>
              </button>
            );
          })}
          {matches.length > 0 && (
            <div className="bq-discover-actions">
              <div className="bq-discover-bottom">
                <button
                  className="btn btn-primary"
                  disabled={loading || !!error || !matches.length}
                  onClick={() => {
                    const selected = matches.flatMap(match => assets.filter(asset => asset.symbol === match.symbol));
                    if (!selected.length) return;
                    trackDiscovery("buy", query ?? "", {
                      mode: selected.length === 1 ? "single" : "batch",
                      stocks: matchSymbols,
                      token_count: selected.length,
                    });
                    if (selected.length === 1) setTrade({ asset: selected[0], side: "buy" });
                    else setBuyList(selected);
                  }}
                >
                  Buy these
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!query || loading || !!error || !matches.length}
                  onClick={() => void share("x")}
                >
                  Share My Stock Mood on X
                </button>
                <button
                  className={`btn btn-secondary${isMiniApp ? "" : " btn-square"}`}
                  disabled={!query || loading || !!error || !matches.length}
                  onClick={() => void share(isMiniApp ? "farcaster" : "system")}
                  aria-label={isMiniApp ? "Share on Farcaster" : "More sharing options"}
                  title={isMiniApp ? "Share your stock mood on Farcaster" : "Share via your device, or copy the link"}
                >
                  {isMiniApp ? "Share on Farcaster" : <ShareIcon className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
              <span className="bq-discover-share-status" role="status">
                {shareStatus}
              </span>
            </div>
          )}
        </div>
      </section>
      {current && (
        <AssetDetails
          asset={current}
          onClose={() => setSelected(undefined)}
          onTrade={selection => {
            setSelected(undefined);
            trackDiscovery(selection.side, query ?? "", { mode: "single", symbol: current.symbol });
            setTrade(selection);
          }}
        />
      )}
      <details className="bq-discover-info dropdown dropdown-top dropdown-end">
        <summary className="btn btn-ghost btn-circle btn-sm" aria-label="About Discover">
          ⓘ
        </summary>
        <div className="dropdown-content bg-base-100 rounded-box shadow-lg">
          <p>
            Matches are business associations generated using the JEV AI model, not predictions of returns or
            personalized investment advice.
          </p>
          <Link href="/atlas">Browse all assets →</Link>
        </div>
      </details>
      {buyList.length > 0 && <BatchBuyDialog assets={buyList} onClose={() => setBuyList([])} />}
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
    </main>
  );
}
