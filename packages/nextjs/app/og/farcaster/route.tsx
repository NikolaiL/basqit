/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export async function GET() {
  const image = await readFile(path.join(process.cwd(), "public/thumbnail.jpg"));
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", background: "#141a2e" }}>
      <img src={`data:image/jpeg;base64,${image.toString("base64")}`} alt="" width={1200} height={630} />
    </div>,
    { width: 1200, height: 800, headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } },
  );
}
