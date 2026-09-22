/* ImageResponse renders native image elements, not next/image. */
/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import logos from "~~/services/discover/logos.json";
import { shareLayout, shareSelection } from "~~/services/discover/share";

const fields: Promise<string>[] = [];
function stockField(variant: number) {
  return (fields[variant] ??= readFile(path.join(process.cwd(), `public/og/stock-field-${variant}.png`)).then(
    data => `data:image/png;base64,${data.toString("base64")}`,
  ));
}

export async function renderShareImage(request: NextRequest, farcaster = false) {
  const height = farcaster ? 800 : 630;
  const { theme, symbols } = shareSelection(
    request.nextUrl.searchParams.get("theme"),
    request.nextUrl.searchParams.get("stocks"),
  );
  const [background, selected] = await Promise.all([
    stockField(shareLayout(request.nextUrl.searchParams.get("layout"), theme)),
    Promise.all(
      symbols.map(async symbol => {
        const file = (logos as Record<string, string>)[symbol];
        const data = await readFile(path.join(process.cwd(), "public", file)).catch(() => null);
        const mime = file.endsWith(".svg") ? "image/svg+xml" : "image/png";
        return { symbol, src: data ? `data:${mime};base64,${data.toString("base64")}` : null };
      }),
    ),
  ]);
  const headline = theme || "What’s your stock mood?";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(160deg, #ffffff 10%, #f1eefe 100%)",
        color: "#171b30",
        fontFamily: "sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 32,
          left: 48,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: -2,
        }}
      >
        basqit<span style={{ color: "#6151eb" }}>.</span>
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: 48,
          top: 30,
          padding: "13px 24px",
          background: "#6151eb",
          color: "white",
          borderRadius: 30,
          fontSize: 23,
        }}
      >
        Find yours ↗
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: farcaster ? 140 : 106,
          fontSize: 16,
          letterSpacing: 4,
          color: "#80749f",
        }}
      >
        MY STOCK MOOD
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          margin: "14px 80px 0",
          height: farcaster ? 150 : 112,
          fontSize: headline.length > 75 ? 36 : headline.length > 40 ? 44 : 60,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -1.5,
        }}
      >
        {headline.length > 115 ? `${headline.slice(0, 112)}…` : headline}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          position: "absolute",
          top: farcaster ? 360 : 275,
          left: 48,
          right: 48,
          gap: selected.length > 6 ? 35 : 50,
        }}
      >
        {selected.map(({ symbol, src }) => (
          <div key={symbol} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 102 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 88,
                height: 88,
                borderRadius: 44,
                background: "white",
                border: "2px solid #c8baff",
                boxShadow: "0 12px 30px rgba(98,76,184,0.10)",
              }}
            >
              {src ? (
                <img src={src} alt="" width={54} height={54} style={{ objectFit: "contain" }} />
              ) : (
                <div style={{ fontSize: 30 }}>●</div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 10,
                padding: "5px 10px",
                background: "#eee9ff",
                borderRadius: 8,
                fontSize: 19,
                fontWeight: 700,
              }}
            >
              {symbol}
            </div>
          </div>
        ))}
        {!selected.length && (
          <div style={{ display: "flex", fontSize: 26, color: "#79738e", marginTop: 32 }}>
            One idea. A world of stocks.
          </div>
        )}
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
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "Vercel-CDN-Cache-Control": "public, s-maxage=604800, stale-while-revalidate=604800",
      },
    },
  );
}
