"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./discovery.css";
import { ShareIcon } from "@heroicons/react/24/outline";
import { StockLogo } from "~~/components/StockLogo";
import { BatchBuyDialog } from "~~/components/trading/BatchBuyDialog";
import { TradeDialog, type TradeSelection } from "~~/components/trading/TradeDialog";
import type { DiscoveryAsset } from "~~/services/discover/catalog";
import { type DiscoveryMatch, normalizeTheme } from "~~/services/discover/matching";
import { surpriseIdeas } from "~~/services/discover/prompts";

const ideas = ["AI Companies", "Tech Giants", "Biotech", "Semiconductors", "Clean Energy", "Space & Satellites"];

export function StockDiscovery({
  assets,
  initialTheme,
  similar,
}: {
  assets: DiscoveryAsset[];
  initialTheme: string;
  similar?: string;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [result, setResult] = useState<{ theme: string; matches: DiscoveryMatch[] }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [trade, setTrade] = useState<TradeSelection>();
  const [buyList, setBuyList] = useState<DiscoveryAsset[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  const resultPanel = useRef<HTMLDivElement>(null);
  const query = normalizeTheme(theme);
  const matches = result?.theme === query ? result.matches : [];
  const source = theme === initialTheme ? similar : undefined;
  const current = assets.find(asset => asset.symbol === selected);

  useEffect(() => {
    setError("");
    setShareStatus("");
    setSelected(undefined);
    if (!query) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/discover?theme=${encodeURIComponent(query)}${source ? `&similar=${encodeURIComponent(source)}` : ""}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not match this idea.");
        if (!controller.signal.aborted) setResult({ theme: query, matches: body.matches });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Try another idea.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, retry, source]);

  function choose(symbol: string) {
    setSelected(symbol);
    requestAnimationFrame(() =>
      resultPanel.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "nearest",
      }),
    );
  }

  async function share(target: "x" | "system") {
    if (!query) return;
    const url = new URL("/discover", window.location.origin);
    url.searchParams.set("theme", query);
    if (source) url.searchParams.set("similar", source);
    const text = `My stock mood: “${query}”${matches.length ? ` — ${matches.map(match => match.symbol).join(", ")}` : ""}. What’s yours?`;
    if (target === "x") {
      const intent = new URL("https://x.com/intent/post");
      intent.searchParams.set("text", text);
      intent.searchParams.set("url", url.href);
      window.open(intent.href, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      if (navigator.share) await navigator.share({ title: "My stock mood · Basqit", text, url: url.href });
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
        <p>Drop an idea. Watch the stocks click.</p>
      </div>
      <section className="bq-discover-playground" aria-label="Explore Stock Tokens by theme">
        <div className="bq-discover-input">
          <span aria-hidden="true">✳</span>
          <input
            aria-label="Your stock theme"
            placeholder="AI companies, biotech, orange logos…"
            value={theme}
            maxLength={180}
            onChange={event => setTheme(event.target.value)}
          />
          {theme && (
            <button className="btn btn-ghost btn-circle" aria-label="Clear theme" onClick={() => setTheme("")}>
              ×
            </button>
          )}
        </div>
        <div className="bq-discover-prompts">
          {ideas.map(idea => (
            <button key={idea} onClick={() => setTheme(idea)}>
              {idea}
            </button>
          ))}
          <button
            onClick={() => {
              const options = surpriseIdeas.filter(idea => idea !== theme);
              setTheme(options[Math.floor(Math.random() * options.length)]);
            }}
          >
            ✦ Surprise me
          </button>
        </div>
        <div className="bq-discover-status" role="status" aria-live="polite">
          {error ||
            (loading
              ? "Basqit is connecting the dots…"
              : query && result?.theme === query
                ? matches.length
                  ? `${matches.length} connections. Tap a logo to take a closer look.`
                  : "No strong connections yet. Try an industry, product or logo color."
                : `${assets.length} little possibilities. One big idea.`)}
          {error && (
            <button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}>
              Retry
            </button>
          )}
        </div>
        <div className={`bq-discover-scene ${loading ? "is-thinking" : ""}`} aria-busy={loading}>
          {loading && (
            <div className="bq-discover-loading" aria-hidden="true">
              <span className="bq-discover-loading-orbit">
                <span>✳</span>
              </span>
              <div>
                <strong>
                  Basqit is thinking<span className="bq-discover-loading-dots">…</span>
                </strong>
                <small>Finding the stocks that fit your idea</small>
              </div>
            </div>
          )}
          <span className="bq-discover-shelf">
            {matches.length ? "YOUR CONNECTIONS" : "LET CURIOSITY DO THE SORTING"}
          </span>
          {assets.map((asset, index) => {
            const rank = matches.findIndex(match => match.symbol === asset.symbol);
            const matched = rank >= 0;
            const style = {
              "--pile-x": `${5 + (((index * 73) % 191) / 191) * 90}%`,
              "--pile-y": `${180 + ((index * 31) % 85)}px`,
              "--mobile-pile-y": `${225 + ((index * 31) % 85)}px`,
              "--tilt": `${((index * 17) % 45) - 22}deg`,
              "--match-x": `${((rank + 0.5) * 100) / Math.max(matches.length, 1)}%`,
              "--mobile-x": `${((rank % 4) + 0.5) * 25}%`,
              "--mobile-y": `${Math.floor(rank / 4) * 88 + 60}px`,
              zIndex: matched ? 3 : 1,
            } as CSSProperties;
            return (
              <button
                key={asset.symbol}
                className={`bq-discover-coin ${matched ? "is-match" : ""}`}
                style={style}
                title={`${asset.symbol} · ${asset.name}`}
                aria-label={`Explore ${asset.symbol}, ${asset.name}`}
                onClick={() => choose(asset.symbol)}
              >
                <StockLogo symbol={asset.symbol} size={46} />
                <span className="bq-discover-ticker">{asset.symbol}</span>
              </button>
            );
          })}
          <div className="bq-discover-ground" />
        </div>
        <div className="bq-discover-bottom">
          <span>Powered by Jev · {assets.length} Stock Tokens</span>
          <button
            className="btn btn-primary"
            disabled={loading || !!error || !matches.length}
            onClick={() => {
              setBuyList(matches.flatMap(match => assets.filter(asset => asset.symbol === match.symbol)));
            }}
          >
            Buy these
          </button>
          <button
            className="btn btn-primary"
            disabled={!query || loading || !!error || !matches.length}
            onClick={() => void share("x")}
          >
            Share my mood on X
          </button>
          <button
            className="btn btn-ghost btn-square"
            disabled={!query || loading || !!error || !matches.length}
            onClick={() => void share("system")}
            aria-label="More sharing options"
            title="Share via your device, or copy the link"
          >
            <ShareIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <span className="bq-discover-share-status" role="status">
          {shareStatus}
        </span>
      </section>
      <div ref={resultPanel} className="bq-discover-results">
        {current ? (
          <article className="card bq-discover-detail">
            <div className="bq-discover-detail-heading">
              <StockLogo symbol={current.symbol} size={56} />
              <div>
                <h2>{current.symbol}</h2>
                <p>{current.name}</p>
              </div>
              <button
                className="btn btn-ghost btn-circle"
                aria-label="Close stock details"
                onClick={() => setSelected(undefined)}
              >
                ×
              </button>
            </div>
            {current.description && <p>{current.description}</p>}
            <div className="bq-discover-detail-actions">
              <button
                className="btn btn-primary"
                disabled={!current.active}
                onClick={() => setTrade({ asset: current, side: "buy" })}
              >
                {current.active ? `Buy ${current.symbol}` : "Currently inactive"}
              </button>
              <a
                href={`https://robinhoodchain.blockscout.com/token/${current.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Token details ↗
              </a>
              {current.website && (
                <a href={current.website} target="_blank" rel="noreferrer">
                  Company / fund ↗
                </a>
              )}
            </div>
          </article>
        ) : (
          <div className="bq-discover-hint">
            {matches.length
              ? "A theme is a starting point. Tap a match, learn what it does, then decide."
              : "Explore AI, biotech, space—or try “orange color logo”."}
          </div>
        )}
        <p className="bq-discover-note">
          Matches are AI-generated business or logo associations, not predictions of returns or personalized investment
          advice. <Link href="/atlas">Browse all assets →</Link>
        </p>
      </div>
      {buyList.length > 0 && <BatchBuyDialog assets={buyList} onClose={() => setBuyList([])} />}
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
    </main>
  );
}
