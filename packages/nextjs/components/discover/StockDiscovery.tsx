"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import "./discovery.css";
import { useAccount } from "wagmi";
import { ShareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Arrow } from "~~/components/Arrow";
import { DialogClose } from "~~/components/DialogClose";
import { LoadingBars } from "~~/components/LoadingBars";
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
import { withRef } from "~~/services/referral";

const noSharedSymbols: string[] = [];
// Matches sit in a hand-stuck row: a small lift and tilt per position, stable between renders.
const stickerJitter = [
  [-8, -7],
  [6, 6],
  [-4, -4],
  [10, 8],
  [-2, -5],
  [7, 9],
  [-10, -3],
  [3, 5],
];
const ideas = [
  ["AI Companies", "#8b5cf6"],
  ["Tech Giants", "#3b82f6"],
  ["Biotech", "#ec4899"],
  ["Semiconductors", "#f97316"],
  ["Clean Energy", "#16a34a"],
  ["Space & Satellites", "#0891b2"],
];

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
  const { address } = useAccount();
  const feeInfo = useRef<HTMLDialogElement>(null);
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
  const themeInput = useRef<HTMLInputElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const placeCaret = useRef(() => {});
  // Fit the typed idea on one line: measure a hidden twin and scale to the input's width. The font's optical
  // size changes glyph widths with the size, so converge over a few passes instead of measuring once.
  useLayoutEffect(() => {
    const input = themeInput.current;
    if (!input?.parentElement) return;
    const twin = document.createElement("span");
    twin.setAttribute("aria-hidden", "true");
    input.parentElement.append(twin);
    const fit = () => {
      const style = getComputedStyle(input);
      Object.assign(twin.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontVariationSettings: style.fontVariationSettings,
        letterSpacing: "-0.03em",
      });
      twin.textContent = input.value || input.placeholder;
      let size = 100;
      for (let pass = 0; pass < 3; pass++) {
        twin.style.fontSize = `${size}px`;
        size = Math.floor((size * input.clientWidth * 0.97) / Math.max(twin.offsetWidth, 1));
      }
      input.style.setProperty("--fit-size", `${size}px`);
      placeCaret.current();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(input);
    void document.fonts.ready.then(fit);
    return () => {
      observer.disconnect();
      twin.remove();
    };
  }, [theme]);
  // A wide brand caret drawn over the input (native carets cannot be widened): measured from the text before the
  // selection, since the idea is centred. Desktop focuses the input on load; phones wait for a tap, so the keyboard
  // does not cover the page.
  useEffect(() => {
    const input = themeInput.current;
    const bar = caret.current;
    if (!input?.parentElement || !bar) return;
    const twin = document.createElement("span");
    twin.setAttribute("aria-hidden", "true");
    input.parentElement.append(twin);
    const width = (text: string) => {
      twin.textContent = text;
      return twin.getBoundingClientRect().width;
    };
    placeCaret.current = () => {
      const start = input.selectionStart ?? input.value.length;
      bar.hidden = document.activeElement !== input || start !== input.selectionEnd;
      if (bar.hidden) return;
      const style = getComputedStyle(input);
      Object.assign(twin.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontVariationSettings: style.fontVariationSettings,
        letterSpacing: style.letterSpacing,
      });
      const padding = parseFloat(style.paddingLeft);
      const room = input.clientWidth - padding - parseFloat(style.paddingRight);
      // Centred text; an empty field puts the caret right after the placeholder, as if it were typed.
      const text = input.value || input.placeholder;
      const before = input.value ? width(input.value.slice(0, start)) : width(text);
      const left = input.offsetLeft + padding + (room - width(text)) / 2 + before;
      Object.assign(bar.style, {
        left: `${left}px`,
        top: `${input.offsetTop + input.offsetHeight / 2}px`,
        fontSize: style.fontSize,
      });
      // Restart the fade on every move, so the caret is solid while typing.
      bar.getAnimations().forEach(animation => (animation.currentTime = 0));
    };
    const place = () => placeCaret.current();
    const events = ["focus", "blur", "input", "keyup", "click", "select"] as const;
    events.forEach(name => input.addEventListener(name, place));
    document.addEventListener("selectionchange", place);
    if (window.matchMedia("(pointer: fine)").matches) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
    place();
    return () => {
      events.forEach(name => input.removeEventListener(name, place));
      document.removeEventListener("selectionchange", place);
      placeCaret.current = () => {};
      twin.remove();
    };
  }, []);
  const query = normalizeTheme(theme);
  // One action for the pile and the keyboard list, so both open the same asset details.
  const openAsset = (symbol: string, matched: boolean) => {
    trackDiscovery("token_open", query ?? "", { symbol, matched });
    setSelected(symbol);
  };
  const matches = result?.theme === query ? result.matches : [];
  const matchSymbols = matches.map(match => match.symbol).join(",");
  const dragQuery = useRef(query);
  useEffect(() => {
    dragQuery.current = query;
  }, [query]);
  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | undefined;
    // Read before the URL is normalised below: ?yolo=1 shows the real fall instead of a settled pile.
    const fall = new URLSearchParams(window.location.search).get("yolo") === "1";
    void import("~~/services/discover/pilePhysics").then(({ attachPilePhysics }) => {
      if (!stopped && scene.current)
        cleanup = attachPilePhysics(
          scene.current,
          coin => trackDiscovery("token_drag", dragQuery.current ?? "", { symbol: coin.dataset.symbol }),
          fall,
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
    const url = withRef(
      new URL(
        discoveryPath(
          query,
          matches.map(match => match.symbol),
          source,
        ),
        window.location.origin,
      ),
      address,
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
      <section className="bq-discover-playground" aria-label="Explore Stock Tokens by theme">
        <h1 className="bq-discover-heading">
          <label htmlFor="bq-discover-theme">I&apos;m in the mood for</label>
        </h1>
        <div className="bq-discover-input has-caret">
          <span ref={caret} className="bq-discover-caret" aria-hidden="true" hidden />
          <input
            id="bq-discover-theme"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            ref={themeInput}
            placeholder="any idea…"
            value={theme}
            maxLength={180}
            onChange={event => {
              entryMethod.current = "typed";
              setTheme(event.target.value);
            }}
          />
          {theme && (
            <button
              className="bq-close"
              aria-label="Clear theme"
              onClick={() => {
                trackDiscovery("clear", theme);
                setTheme("");
              }}
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="bq-discover-prompts">
          {ideas.map(([idea, color]) => (
            <button
              key={idea}
              style={{ "--chip": color } as CSSProperties}
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
            className="is-surprise"
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
                  ? `${matches.length} ${matches.length === 1 ? "connection" : "connections"}. Tap a logo to take a closer look.`
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
              {/* The logo's three bars, bouncing while the idea is matched. */}
              <LoadingBars />
            </div>
          )}
          {assets.map(asset => {
            const rank = matches.findIndex(match => match.symbol === asset.symbol);
            const matched = rank >= 0;
            const rowSize = Math.min(4, matches.length - Math.floor(rank / 4) * 4);
            const [lift, tilt] = stickerJitter[rank % stickerJitter.length] ?? [0, 0];
            const style = {
              "--match-offset": rank - (matches.length - 1) / 2,
              "--match-lift": `${lift}px`,
              "--match-tilt": `${tilt}deg`,
              "--match-x": `${((rank + 0.5) * 100) / Math.max(matches.length, 1)}%`,
              "--mobile-x": `${((rank % 4) + 0.5 + (4 - rowSize) / 2) * 25}%`,
              "--mobile-y": `${Math.floor(rank / 4) * 88 + 40}px`,
              zIndex: matched ? 3 : 1,
            } as CSSProperties;
            return (
              <button
                key={asset.symbol}
                data-symbol={asset.symbol}
                className={`bq-discover-coin ${matched ? "is-match" : ""}`}
                // Only matches are in the tab order; the rest of the pile stays clickable. Keyboard users browse every
                // stock through the list below instead of tabbing through the pile.
                tabIndex={matched ? undefined : -1}
                style={style}
                title={`${asset.symbol} · ${asset.name}`}
                aria-label={`Explore ${asset.symbol}, ${asset.name}`}
                onClick={() => openAsset(asset.symbol, matched)}
              >
                <StockLogo symbol={asset.symbol} size={46} />
                <span className="bq-discover-ticker">{asset.symbol}</span>
              </button>
            );
          })}
          {matches.length > 0 && (
            <div
              className="bq-discover-actions"
              style={{ "--match-rows": Math.ceil(matches.length / 4) } as CSSProperties}
            >
              <div className="bq-discover-bottom">
                <button
                  className="btn bq-discover-buy"
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
                <div className="bq-discover-share">
                  <button
                    className="btn btn-secondary"
                    disabled={!query || loading || !!error || !matches.length}
                    onClick={() => void share("x")}
                  >
                    {address ? "Share and earn when friends trade" : "Share My Stock Mood on X"}
                  </button>
                  {address && !shareStatus && (
                    <button type="button" className="link" onClick={() => feeInfo.current?.showModal()}>
                      More info
                    </button>
                  )}
                </div>
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
              <dialog ref={feeInfo} className="modal" aria-labelledby="bq-fee-split-title">
                <div className="modal-box">
                  <DialogClose label="Close" onClick={() => feeInfo.current?.close()} />
                  <h2 id="bq-fee-split-title" className="text-lg font-bold">
                    Share the link, we share the fees
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 py-3">
                    <li>Your link carries your wallet address.</li>
                    <li>
                      When someone opens it and buys or sells stocks on Basqit, you get half of the Basqit fee on that
                      trade. The fee is shown before every trade.
                    </li>
                    <li>They pay the same fee either way.</li>
                    <li>Your share goes to your wallet in the same onchain transaction. Nothing to claim.</li>
                    <li>The last link they opened counts. Your own trades don&apos;t.</li>
                    <li>For now this covers stock trades only.</li>
                  </ul>
                  <button className="btn btn-primary btn-sm" onClick={() => feeInfo.current?.close()}>
                    Got it
                  </button>
                </div>
                <form method="dialog" className="modal-backdrop">
                  <button>Close</button>
                </form>
              </dialog>
            </div>
          )}
        </div>
        <details className="bq-discover-browse">
          <summary>Browse all {assets.length} stocks as a list</summary>
          <ul>
            {assets.map(asset => (
              <li key={asset.symbol}>
                <button
                  type="button"
                  onClick={() =>
                    openAsset(
                      asset.symbol,
                      matches.some(m => m.symbol === asset.symbol),
                    )
                  }
                >
                  <b>{asset.symbol}</b> {asset.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
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
          <Link href="/atlas">
            Browse all assets <Arrow />
          </Link>
        </div>
      </details>
      {buyList.length > 0 && <BatchBuyDialog assets={buyList} onClose={() => setBuyList([])} />}
      {trade && <TradeDialog selection={trade} onClose={() => setTrade(undefined)} />}
    </main>
  );
}
