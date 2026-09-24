/* ImageResponse renders native image elements, not next/image. */
/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import logos from "~~/services/discover/logos.json";
import { shareLayout, shareSelection } from "~~/services/discover/share";

const INK = "#141a2e";
const MUTED = "#5d5a7a";
// Same hand-stuck tilt and lift as the Discover page, so a shared card looks like the screen.
const JITTER = [
  [-8, -7],
  [6, 6],
  [-4, -4],
  [10, 8],
  [-2, -5],
  [7, 9],
  [-10, -3],
  [3, 5],
];

// Shown on the main card, when there is no idea yet.
const SHOWCASE = ["NVDA", "AAPL", "TSLA", "PLTR", "AMZN", "META", "COIN", "RKLB"];

const files = new Map<string, Promise<Buffer>>();
const publicFile = (file: string) => {
  if (!files.has(file)) files.set(file, readFile(path.join(process.cwd(), "public", file)));
  return files.get(file)!;
};
const dataUrl = async (file: string, mime: string) =>
  `data:${mime};base64,${(await publicFile(file)).toString("base64")}`;

export async function renderShareImage(request: NextRequest, farcaster = false) {
  const height = farcaster ? 800 : 630;
  const { theme, symbols } = shareSelection(
    request.nextUrl.searchParams.get("theme"),
    request.nextUrl.searchParams.get("stocks"),
  );
  const [background, mark, bold, semibold, selected] = await Promise.all([
    dataUrl(`og/stock-field-${shareLayout(request.nextUrl.searchParams.get("layout"), theme)}.png`, "image/png"),
    dataUrl("basqit-logo.svg", "image/svg+xml"),
    // Static instances of the variable font at the page's settings (wdth 88, display optical size).
    publicFile("og/fonts/bricolage-grotesque-800-display.ttf"),
    publicFile("og/fonts/bricolage-grotesque-600.ttf"),
    Promise.all(
      (theme || symbols.length ? symbols : SHOWCASE).map(async symbol => {
        const file = (logos as Record<string, string>)[symbol];
        const src = await dataUrl(file, file.endsWith(".svg") ? "image/svg+xml" : "image/png").catch(() => null);
        return { symbol, src };
      }),
    ),
  ]);
  const label = theme ? "I’m in the mood for" : "Type an idea, get real Stock Tokens";
  const headline = theme ? (theme.length > 80 ? `${theme.slice(0, 78)}…` : theme) : "What’s your stock mood?";
  // Roughly 0.44em per character at this weight: one line while it fits at 64px or more, else two lines.
  const chars = Math.max(headline.length, 10);
  const oneLine = 1080 / (chars * 0.44);
  const size = Math.round(oneLine >= 64 ? Math.min(104, oneLine) : Math.min(72, (1.8 * 1080) / (chars * 0.44)));
  const logo = selected.length > 6 ? 92 : 108;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: "#efebff",
        color: INK,
        fontFamily: "Bricolage",
        overflow: "hidden",
      }}
    >
      <img src={mark} alt="" width={183} height={46} style={{ position: "absolute", top: 38, left: 44 }} />
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: 48,
          top: 36,
          padding: "12px 24px",
          background: INK,
          color: "white",
          borderRadius: 999,
          fontSize: 24,
          fontWeight: 600,
        }}
      >
        Find Your Stock Tokens
      </div>
      <div style={{ display: "flex", marginTop: farcaster ? 150 : 112, fontSize: 28, fontWeight: 600, color: MUTED }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 2,
          fontSize: size,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -size * 0.03,
          width: 1100,
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {headline}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: farcaster ? 56 : 30, gap: 22 }}>
        {selected.map(({ symbol, src }, index) => (
          <div
            key={symbol}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              transform: `translateY(${JITTER[index][0]}px) rotate(${JITTER[index][1]}deg)`,
            }}
          >
            {src ? (
              <img src={src} alt="" width={logo} height={logo} style={{ objectFit: "contain", borderRadius: 24 }} />
            ) : (
              <div style={{ display: "flex", width: logo, height: logo }} />
            )}
            <div
              style={{
                display: "flex",
                marginTop: -12,
                padding: "3px 12px",
                background: INK,
                color: "white",
                borderRadius: 999,
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {symbol}
            </div>
          </div>
        ))}
      </div>
      <img
        src={background}
        alt=""
        width={1200}
        height={198}
        style={{ position: "absolute", left: 0, top: height - 198 }}
      />
    </div>,
    {
      width: 1200,
      height,
      fonts: [
        { name: "Bricolage", data: bold, weight: 800, style: "normal" },
        { name: "Bricolage", data: semibold, weight: 600, style: "normal" },
      ],
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "Vercel-CDN-Cache-Control": "public, s-maxage=604800, stale-while-revalidate=604800",
      },
    },
  );
}
