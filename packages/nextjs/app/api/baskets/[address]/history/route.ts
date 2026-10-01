import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { readPricesAndSupply, readTimeline, tokensEverHeld } from "~~/services/baskets/chain";
import { earliestSnapshot, hasDatabase, hasRebuild, insertSnapshots, readSnapshots } from "~~/services/baskets/db";
import { type Point, backfillNeeded, chartStep, rebuildHistory, thin, windowed } from "~~/services/baskets/history";
import { testnetAssets } from "~~/services/packs/testnet";

export const runtime = "nodejs";
export const revalidate = 300;

// Window and thinning step per range, in seconds.
const RANGES = { "1d": [86_400, 300], "1w": [604_800, 1_800], all: [Infinity, 3_600] } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return NextResponse.json({ error: "Not a basket" }, { status: 404 });
  const range = (request.nextUrl.searchParams.get("range") ?? "all") as keyof typeof RANGES;
  const [span, step] = RANGES[range] ?? RANGES.all;

  const timeline = await readTimeline(address);
  if (!timeline) return NextResponse.json({ error: "Not a basket" }, { status: 404 });
  const { usdg } = await testnetAssets();
  const rebalances = timeline.rebalances.map(r => r.at);
  const from = span === Infinity ? 0 : Math.floor(Date.now() / 1000) - span;
  // Prices and supply from chain: the costly read, done only to rebuild missing history.
  const fullEvents = async () => ({ ...timeline, ...(await readPricesAndSupply(address, tokensEverHeld(timeline))) });

  let points: Point[];
  let fromChain = false;
  try {
    if (!hasDatabase()) throw new Error("no database");
    const [earliest, rebuilt] = await Promise.all([earliestSnapshot(address), hasRebuild(address)]);
    // Rebuild the gap before the first stored point once; afterwards Postgres alone serves the chart.
    if (backfillNeeded({ earliest, createdAt: timeline.createdAt, rebuilt })) {
      await insertSnapshots(address, rebuildHistory(await fullEvents(), usdg, earliest ?? Infinity));
    }
    points = await readSnapshots(address, from);
  } catch {
    fromChain = true;
    points = windowed(rebuildHistory(await fullEvents(), usdg), from);
  }

  const shown = thin(points, chartStep(points, step), new Set(rebalances));
  return NextResponse.json({
    points: shown.map(p => ({ at: p.at, value: p.value.toString(), supply: p.supply.toString(), source: p.source })),
    rebalances,
    createdAt: timeline.createdAt,
    fromChain,
  });
}
