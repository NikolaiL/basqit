import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { basketEvent, factoryEvents, routerEvent } from "~~/services/baskets/abi";
import { type Activity, holdersFromTransfers, mergeActivity } from "~~/services/baskets/activity";
import { timeOf } from "~~/services/baskets/chain";
import { packsClient, packsTestnet } from "~~/services/packs/testnet";

export const runtime = "nodejs";
export const revalidate = 15;

/** Holders and transactions of one basket, from chain logs since the factory's deploy. */
export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address) || !packsTestnet) return NextResponse.json({ error: "Not a basket" }, { status: 404 });
  const fromBlock = BigInt(packsTestnet.deployBlock);
  const [created, transfers, minted, redeemed, announced, rebalanced, cancelled, bought, sold] = await Promise.all([
    packsClient.getLogs({
      address: packsTestnet.factory,
      event: factoryEvents[0],
      args: { basket: address },
      fromBlock,
    }),
    packsClient.getLogs({ address, event: basketEvent("Transfer"), fromBlock }),
    packsClient.getLogs({ address, event: basketEvent("Minted"), fromBlock }),
    packsClient.getLogs({ address, event: basketEvent("Redeemed"), fromBlock }),
    packsClient.getLogs({ address, event: basketEvent("RebalanceScheduled"), fromBlock }),
    packsClient.getLogs({ address, event: basketEvent("Rebalanced"), fromBlock }),
    packsClient.getLogs({ address, event: basketEvent("RebalanceCancelled"), fromBlock }),
    packsClient.getLogs({
      address: packsTestnet.purchaseRouter,
      event: routerEvent("BasketPurchased"),
      args: { basket: address },
      fromBlock,
    }),
    packsClient.getLogs({
      address: packsTestnet.sellRouter,
      event: routerEvent("BasketSold"),
      args: { basket: address },
      fromBlock,
    }),
  ]);
  if (!created.length) return NextResponse.json({ error: "Not a basket" }, { status: 404 });

  // Only the creator can manage, so manager rows name the creator.
  const manager = created[0].args.creator!;
  const row = async (
    log: { transactionHash: `0x${string}` | null; blockTimestamp?: bigint | null; blockNumber: bigint | null },
    kind: Activity["kind"],
    who: string,
    shares?: bigint,
    usdg?: bigint,
  ): Promise<Activity> => ({ at: await timeOf(log), hash: log.transactionHash!, kind, who, shares, usdg });
  const rows = await Promise.all([
    ...created.map(l => row(l, "created", l.args.creator!)),
    ...minted.map(l => row(l, "minted", l.args.to!, l.args.shares!)),
    ...redeemed.map(l => row(l, "redeemed", l.args.sender!, l.args.shares!)),
    ...announced.map(l => row(l, "announced", manager)),
    ...rebalanced.map(l => row(l, "rebalanced", manager)),
    ...cancelled.map(l => row(l, "cancelled", manager)),
    ...bought.map(l => row(l, "bought", l.args.recipient!, l.args.shares!, l.args.usdGSpent!)),
    ...sold.map(l => row(l, "sold", l.args.seller!, l.args.shares!, l.args.usdGReceived!)),
  ]);
  const holders = holdersFromTransfers(
    transfers.map(l => ({ from: l.args.from!, to: l.args.to!, value: l.args.value! })),
    [packsTestnet.purchaseRouter, packsTestnet.sellRouter],
  );
  return NextResponse.json({
    holders: holders.map(h => ({ address: h.address, shares: h.shares.toString() })),
    activity: mergeActivity(rows).map(r => ({ ...r, shares: r.shares?.toString(), usdg: r.usdg?.toString() })),
  });
}
