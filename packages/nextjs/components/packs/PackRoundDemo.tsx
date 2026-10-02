"use client";

import { useState } from "react";
import {
  demoError,
  deployment,
  ensureAllowance,
  formatToken,
  formatUsd,
  usePacksWrite,
  useTestUsdg,
  useTokens,
  useUsdPrices,
} from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { type Address, type Hex, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { LoadingBars } from "~~/components/LoadingBars";
import { StockLogo } from "~~/components/StockLogo";
import { packsClient, robinhoodTestnet } from "~~/services/packs/testnet";

const STATUS = ["None", "Selling", "Sold out", "Drawing", "Seeded", "Finalized", "Cancelled"] as const;

type Round = {
  payToken: Address;
  price: bigint;
  saleDeadline: bigint;
  drawTimeout: bigint;
  closedAt: bigint;
  requestedAt: bigint;
  sequence: bigint;
  provider: Address;
  feePayer: Address;
  size: number;
  status: number;
  proceedsTaken: boolean;
  seed: Hex;
  salesHash: Hex;
};
type Prize = { token: Address; amount: bigint };

export function PackRoundDemo() {
  const { address, chainId } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const usd = useUsdPrices(Object.values(tokens.data ?? {}).map(token => token.ticker));
  const [count, setCount] = useState("1");
  // Latest round by default; earlier rounds stay reachable so their buyers can still claim or get refunds.
  const [picked, setPicked] = useState<bigint>();
  const [busy, setBusy] = useState("");
  // The last failure and the action it belongs to, shown right under that action.
  const [failed, setFailed] = useState<{ at: string; message: string }>();
  const usdgBalance = useTestUsdg(address).data;
  const ethBalance = useQuery({
    queryKey: ["packs-eth", address],
    enabled: !!address,
    queryFn: () => packsClient.getBalance({ address: address! }),
  }).data;
  const ready = !!address && chainId === robinhoodTestnet.id;
  const packs = { address: deployment.packs, abi: deployment.abis.packs } as const;

  const state = useQuery({
    queryKey: ["packs-rounds", address, String(picked)],
    refetchInterval: query => (query.state.data?.round.status === 3 ? 2_000 : 10_000),
    queryFn: async () => {
      const [latest, templatePrizes] = (await Promise.all([
        packsClient.readContract({ ...packs, functionName: "roundCount" }),
        packsClient.readContract({ ...packs, functionName: "templatePrizes" }),
      ])) as [bigint, Prize[]];
      const roundId = picked && picked <= latest ? picked : latest;
      const [round, prizes, owners, order, fee] = await Promise.all([
        packsClient.readContract({ ...packs, functionName: "getRound", args: [roundId] }),
        packsClient.readContract({ ...packs, functionName: "prizesOf", args: [roundId] }),
        packsClient.readContract({ ...packs, functionName: "ownersOf", args: [roundId] }),
        packsClient.readContract({ ...packs, functionName: "assignmentOf", args: [roundId] }),
        packsClient.readContract({ ...packs, functionName: "drawFee" }),
      ]);
      const owned = (owners as Address[]).flatMap((owner, packId) =>
        address && owner.toLowerCase() === address.toLowerCase() ? [packId] : [],
      );
      const settled = await Promise.all(
        owned.map(packId =>
          packsClient.readContract({ ...packs, functionName: "settled", args: [roundId, BigInt(packId)] }),
        ),
      );
      const slots = (order as Hex).length > 2 ? Array.from(Buffer.from((order as Hex).slice(2), "hex")) : [];
      return {
        latest,
        roundId,
        // Anyone may open the next round from the template once its latest round is done.
        canStartNext: templatePrizes.length > 0 && roundId === latest,
        round: round as Round,
        prizes: prizes as Prize[],
        sold: (owners as Address[]).length,
        mine: owned.map((packId, i) => ({ packId, settled: settled[i] as boolean, slot: slots[packId] })),
        fee: fee as bigint,
        now: Math.floor(Date.now() / 1000),
      };
    },
  });

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setFailed(undefined);
    try {
      await action();
    } catch (failure) {
      setFailed({ at: label, message: demoError(failure) });
    } finally {
      setBusy("");
    }
  };
  const errorAt = (prefix: string) =>
    failed?.at.startsWith(prefix) ? (
      <p className="bq-demo-error" role="alert">
        {failed.message}
      </p>
    ) : null;

  const data = state.data;
  if (!data || data.roundId === 0n) return null;
  const { round, prizes, sold, mine, fee, now, roundId, latest, canStartNext } = data;
  const left = round.size - sold;
  const qty = Number(count);
  // Checked before the wallet opens; the contract still enforces it if balances change in between.
  const shortOfUsdg = !!address && !!qty && usdgBalance !== undefined && usdgBalance < round.price * BigInt(qty);
  const shortOfEth = !!address && ethBalance !== undefined && ethBalance < fee;
  const pending = mine.filter(pack => !pack.settled);
  const status = STATUS[round.status];
  const expired =
    (round.status === 1 && now > Number(round.saleDeadline)) ||
    (round.status === 2 && now > Number(round.closedAt + round.drawTimeout)) ||
    (round.status === 3 && now > Number(round.requestedAt + round.drawTimeout));
  const usdOf = (prize: Prize) => {
    const token = tokens.data?.[prize.token.toLowerCase()];
    const price = token && usd.data?.[token.ticker];
    return price ? Number(formatUnits(prize.amount, token.decimals)) * price : undefined;
  };
  const prizeLabel = (prize: Prize) => {
    const token = tokens.data?.[prize.token.toLowerCase()];
    if (!token) return "…";
    const value = usdOf(prize);
    return `${formatToken(prize.amount, token.decimals)} ${token.symbol}${value ? ` ≈ ${formatUsd(value)}` : ""}`;
  };
  const values = prizes.map(usdOf);
  const total = values.every(value => value !== undefined) ? values.reduce((a, b) => a! + b!, 0) : undefined;
  // Most valuable first; raw amounts only until prices load.
  const sorted = [...prizes].sort((a, b) =>
    total !== undefined ? usdOf(b)! - usdOf(a)! : b.amount > a.amount ? 1 : -1,
  );

  return (
    <section className="bq-demo-block">
      <div className="bq-demo-round-nav">
        <h3>Pack round #{String(roundId)}</h3>
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Previous round"
          disabled={roundId <= 1n}
          onClick={() => setPicked(roundId - 1n)}
        >
          ‹
        </button>
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Next round"
          disabled={roundId >= latest}
          onClick={() => setPicked(roundId + 1n)}
        >
          ›
        </button>
      </div>
      <p className="bq-demo-note">
        {status} · {sold} of {round.size} sold · {formatToken(round.price, 6)} tUSDG per pack. Some packs are worth less
        than you paid.
        {total !== undefined && (
          <>
            {" "}
            All prizes together ≈ {formatUsd(total)} against {formatToken(round.price * BigInt(round.size), 6)} tUSDG in
            sales, at live mainnet Stock Token prices. The test tokens themselves have no value.
          </>
        )}
      </p>
      <ul className="bq-demo-prizes" aria-label="Prizes in this round">
        {sorted.map((prize, i) => (
          <li key={i}>
            <StockLogo symbol={tokens.data?.[prize.token.toLowerCase()]?.ticker ?? ""} size={22} />
            {prizeLabel(prize)}
          </li>
        ))}
      </ul>

      {round.status === 1 && !expired && (
        <div className="bq-demo-row">
          <input
            className="input"
            type="number"
            min={1}
            max={left}
            value={count}
            aria-label="Packs to buy"
            onChange={event => {
              const value = event.target.value;
              setCount(value === "" ? "" : String(Math.max(1, Math.min(left, Math.floor(Number(value)) || 1))));
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={!ready || !!busy || left === 0 || !qty || shortOfUsdg}
            onClick={() =>
              act("buy", async () => {
                const cost = round.price * BigInt(qty);
                await ensureAllowance(write, address!, round.payToken, deployment.packs, cost);
                // Packs are a paid entry with a random payout and stay legally gated: buying in is not celebrated.
                await write(
                  { ...packs, functionName: "buy", args: [roundId, BigInt(qty), address] },
                  { celebrate: false },
                );
              })
            }
          >
            {busy === "buy"
              ? "Buying…"
              : shortOfUsdg
                ? "Not enough tUSDG"
                : qty
                  ? `Buy ${qty} for ${formatToken(round.price * BigInt(qty), 6)} tUSDG`
                  : "Buy"}
          </button>
        </div>
      )}
      {round.status === 1 && !expired && shortOfUsdg && (
        <p className="bq-demo-note">
          You have {formatToken(usdgBalance ?? 0n, 6)} tUSDG. Get free test USDG in step 3 above, then buy.
        </p>
      )}
      {errorAt("buy")}
      {round.status === 2 && !expired && (
        <button
          className="btn btn-primary btn-sm"
          disabled={!ready || !!busy || shortOfEth}
          onClick={() =>
            act("draw", () => write({ ...packs, functionName: "requestDraw", args: [roundId], value: fee }))
          }
        >
          {busy === "draw"
            ? "Requesting…"
            : shortOfEth
              ? "Not enough test ETH for the Dice fee"
              : `Start the draw (Dice fee ${formatToken(fee, 18)} ETH)`}
        </button>
      )}
      {errorAt("draw")}
      {round.status === 3 && !expired && (
        <p className="bq-demo-wait">
          <LoadingBars small /> Waiting for Dice to reveal request #{String(round.sequence)}. Usually a few seconds.
        </p>
      )}
      {round.status === 4 && (
        <button
          className="btn btn-primary btn-sm"
          disabled={!ready || !!busy}
          onClick={() => act("finalize", () => write({ ...packs, functionName: "finalize", args: [roundId] }))}
        >
          {busy === "finalize" ? "Shuffling…" : "Shuffle and reveal the packs"}
        </button>
      )}
      {expired && (
        <button
          className="btn btn-secondary btn-sm"
          disabled={!ready || !!busy}
          onClick={() => act("cancel", () => write({ ...packs, functionName: "cancel", args: [roundId] }))}
        >
          Cancel round and unlock refunds
        </button>
      )}
      {canStartNext && (round.status === 5 || round.status === 6) && (
        <button
          className="btn btn-primary btn-sm"
          disabled={!ready || !!busy}
          onClick={() =>
            act("next", async () => {
              await write({ ...packs, functionName: "startNextRound" }, { celebrate: false });
              setPicked(undefined);
            })
          }
        >
          {busy === "next" ? "Starting…" : "Start the next round"}
        </button>
      )}
      {round.status === 6 && address && round.feePayer.toLowerCase() === address.toLowerCase() && (
        <button
          className="btn btn-secondary btn-sm"
          disabled={!ready || !!busy}
          onClick={() => act("fee", () => write({ ...packs, functionName: "refundDiceFee", args: [roundId] }))}
        >
          Reclaim the Dice fee
        </button>
      )}
      {errorAt("finalize")}
      {errorAt("cancel")}
      {errorAt("next")}
      {errorAt("fee")}

      {mine.length > 0 && (
        <div className="bq-demo-mine">
          <h4>Your packs</h4>
          {pending.length > 1 && (round.status === 5 || round.status === 6) && (
            <button
              className="btn btn-primary btn-sm bq-demo-all"
              disabled={!ready || !!busy}
              onClick={() =>
                // One transaction in any wallet: the contract settles every pack the caller owns in the round.
                act("all", () =>
                  write({ ...packs, functionName: round.status === 5 ? "claimAll" : "refundAll", args: [roundId] }),
                )
              }
            >
              {busy === "all"
                ? round.status === 5
                  ? "Claiming…"
                  : "Refunding…"
                : `${round.status === 5 ? "Claim" : "Refund"} all ${pending.length}`}
            </button>
          )}
          <ul>
            {mine.map(pack => (
              <li key={pack.packId}>
                Pack #{pack.packId}
                {round.status === 5 && pack.slot !== undefined && <> · {prizeLabel(prizes[pack.slot])}</>}
                {round.status === 5 && !pack.settled && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!ready || !!busy}
                    onClick={() =>
                      act(`claim-${pack.packId}`, () =>
                        write({ ...packs, functionName: "claim", args: [roundId, BigInt(pack.packId)] }),
                      )
                    }
                  >
                    Claim
                  </button>
                )}
                {round.status === 6 && !pack.settled && (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={!ready || !!busy}
                    onClick={() =>
                      act(`refund-${pack.packId}`, () =>
                        write({ ...packs, functionName: "refund", args: [roundId, BigInt(pack.packId)] }),
                      )
                    }
                  >
                    Refund
                  </button>
                )}
                {pack.settled && <span className="bq-demo-ok">{round.status === 5 ? "Claimed" : "Refunded"}</span>}
              </li>
            ))}
          </ul>
          {errorAt("all")}
          {errorAt("claim-")}
          {errorAt("refund-")}
        </div>
      )}
      {round.seed !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
        <p className="bq-demo-seed">
          Seed from Dice: <code>{round.seed}</code>
        </p>
      )}
    </section>
  );
}
