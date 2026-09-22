import { NextRequest, NextResponse } from "next/server";
import { readCatalog } from "~~/services/atlas/catalog";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  const { assets, unavailable } = await readCatalog();
  if (unavailable) return NextResponse.json({ error: "Asset details unavailable" }, { status: 503 });
  const asset = assets.find(asset => asset.symbol === symbol);
  return asset
    ? NextResponse.json(asset, { headers: { "Cache-Control": "public, max-age=30" } })
    : NextResponse.json({ error: "Asset not found" }, { status: 404 });
}
