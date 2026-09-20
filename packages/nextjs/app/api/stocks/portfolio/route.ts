import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getPortfolio } from "~~/services/portfolio/server";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ error: "Enter a valid wallet address." }, { status: 400 });
  try {
    return NextResponse.json(await getPortfolio(address), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "We couldn’t read your balances. Please try again. Your assets are unaffected." },
      { status: 503 },
    );
  }
}
