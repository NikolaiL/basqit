import { NextResponse } from "next/server";
import { factoryEvents } from "~~/services/baskets/abi";
import { timeOf } from "~~/services/baskets/chain";
import { hasDatabase, readValueRefs } from "~~/services/baskets/db";
import { packsClient, packsTestnet } from "~~/services/packs/testnet";

export const runtime = "nodejs";
export const revalidate = 60;

const WINDOWS = { "24h": 86_400, "7d": 604_800 } as const;

/**
 * For every basket: when it was created, and its value per share at the start of each window (24h, 7d, all time), so
 * the cards can show the change against the live price. A window is null when the basket is younger than it or the
 * stored history does not reach back to creation.
 */
export async function GET() {
  if (!packsTestnet) return NextResponse.json({});
  const [created, refs] = await Promise.all([
    packsClient.getLogs({
      address: packsTestnet.factory,
      event: factoryEvents[0],
      fromBlock: BigInt(packsTestnet.deployBlock),
    }),
    hasDatabase() ? readValueRefs().catch(() => []) : [],
  ]);
  const now = Date.now() / 1000;
  const summary: Record<string, { createdAt: number; refs: Record<"24h" | "7d" | "all", string | null> }> = {};
  await Promise.all(
    created.map(async log => {
      const basket = log.args.basket!.toLowerCase();
      const createdAt = await timeOf(log);
      const ref = refs.find(r => r.basket === basket);
      // History stored from (nearly) the start: the cron runs every 5 minutes, a rebuild starts at creation.
      const complete = !!ref && ref.firstAt - createdAt <= 600;
      summary[basket] = {
        createdAt,
        refs: {
          "24h": complete && now - createdAt >= WINDOWS["24h"] ? ref["24h"] : null,
          "7d": complete && now - createdAt >= WINDOWS["7d"] ? ref["7d"] : null,
          all: complete ? ref.all : null,
        },
      };
    }),
  );
  return NextResponse.json(summary);
}
