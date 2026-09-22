import { NextRequest, NextResponse } from "next/server";
import { readFundingTokenLogo } from "~~/services/funding/tokenLogos";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  const params = request.nextUrl.searchParams;
  if (
    [...params.keys()].some(key => !["network", "address"].includes(key)) ||
    params.getAll("network").length !== 1 ||
    params.getAll("address").length !== 1
  )
    return NextResponse.json({ error: "Supply one network and token address." }, { status: 400 });
  try {
    const logo = await readFundingTokenLogo(params.get("network")!, params.get("address")!);
    return NextResponse.json(
      { logo },
      { headers: { "Cache-Control": logo ? "public, max-age=2592000" : "public, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ error: "Logo unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
