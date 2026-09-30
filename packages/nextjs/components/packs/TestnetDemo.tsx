"use client";

import { useRef, useState } from "react";
import { BasketsDemo } from "./BasketsDemo";
import { GiftsDemo } from "./GiftsDemo";
import { PackRoundDemo } from "./PackRoundDemo";
import { deployment, formatToken, usePacksWrite } from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { Arrow } from "~~/components/Arrow";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import {
  DICE_DOCS,
  DICE_SITE,
  TESTNET_ETH_FAUCET,
  packsClient,
  packsTestnet,
  robinhoodTestnet,
  testnetAssets,
} from "~~/services/packs/testnet";
import { getParsedError } from "~~/utils/scaffold-eth";

/** Baskets, Gifts or Packs on Robinhood Chain testnet: test tokens with no value; Packs use real Dice Protocol draws. */
export function TestnetDemo({ kind }: { kind: "baskets" | "gifts" | "packs" }) {
  const title = `Try ${kind[0].toUpperCase()}${kind.slice(1)} on testnet`;
  const { address, chainId } = useAccount();
  const { openConnectModal } = useWalletConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const write = usePacksWrite();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const lock = useRef(false);
  const onTestnet = chainId === robinhoodTestnet.id;
  const balances = useQuery({
    queryKey: ["packs-balances", address],
    enabled: !!packsTestnet && !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const [eth, usdg, next] = await Promise.all([
        packsClient.getBalance({ address: address! }),
        packsClient.readContract({
          address: (await testnetAssets()).usdg,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        }),
        packsClient
          .readContract({
            address: deployment.faucet,
            abi: deployment.abis.faucet,
            functionName: "lastDrip",
            args: [address!],
          })
          .then(last => ((last as bigint) === 0n ? 0 : Number(last as bigint) + 86_400)),
      ]);
      return { eth, usdg, canDrip: next * 1000 < Date.now() };
    },
  });

  if (!packsTestnet)
    return (
      <section className="bq-demo">
        <h2>{title}</h2>
        <p>The testnet demo is being deployed. Check back soon.</p>
      </section>
    );

  // One wallet action at a time: repeated clicks must not open more prompts or send transactions that revert.
  const run = async (label: string, action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setPending(label);
    setError("");
    try {
      await action();
      await balances.refetch();
    } catch (failure) {
      setError(getParsedError(failure));
    } finally {
      lock.current = false;
      setPending("");
    }
  };
  const canDrip = balances.data?.canDrip ?? true;

  return (
    <section className="bq-demo" aria-labelledby="bq-demo-title">
      <h2 id="bq-demo-title">{title}</h2>
      <p className="bq-demo-lead">
        Everything below runs on Robinhood Chain testnet with test tokens that have no value.
        {kind === "packs" && (
          <>
            {" "}
            Packs are drawn by{" "}
            <a href={DICE_SITE} target="_blank" rel="noreferrer">
              Dice Protocol <Arrow out />
            </a>
            , a commit-reveal randomness oracle.
          </>
        )}
      </p>

      <ol className="bq-demo-steps">
        <li>
          <strong>Connect on testnet</strong>
          {!address ? (
            <button className="btn btn-primary btn-sm" onClick={openConnectModal}>
              Connect wallet
            </button>
          ) : onTestnet ? (
            <span className="bq-demo-ok">Connected to Robinhood Chain Testnet</span>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={!!pending}
              onClick={() => run("Switching…", () => switchChainAsync({ chainId: robinhoodTestnet.id }))}
            >
              {pending === "Switching…" ? pending : "Switch to Robinhood Chain Testnet"}
            </button>
          )}
        </li>
        <li>
          <strong>Get test ETH for gas</strong>
          <span>
            {balances.data ? `${formatToken(balances.data.eth, 18)} ETH · ` : ""}
            <a href={TESTNET_ETH_FAUCET} target="_blank" rel="noreferrer">
              Robinhood testnet faucet <Arrow out />
            </a>
          </span>
        </li>
        <li>
          <strong>Get test USDG</strong>
          <span>{balances.data ? `${formatToken(balances.data.usdg, 6)} tUSDG` : ""}</span>
          <button
            className="btn btn-primary btn-sm"
            disabled={!address || !onTestnet || !canDrip || !!pending}
            onClick={() =>
              run("Confirming…", () =>
                write({ address: deployment.faucet, abi: deployment.abis.faucet, functionName: "drip" }),
              )
            }
          >
            {pending === "Confirming…" ? pending : canDrip ? "Get 100 test USDG" : "Come back tomorrow"}
          </button>
        </li>
      </ol>
      {error && (
        <p className="bq-demo-error" role="alert">
          {error}
        </p>
      )}

      {kind === "baskets" && <BasketsDemo onError={setError} />}
      {kind === "gifts" && <GiftsDemo onError={setError} />}
      {kind === "packs" && <PackRoundDemo onError={setError} />}

      {kind === "packs" && (
        <aside className="bq-demo-dice">
          <h3>How Packs are drawn</h3>
          <p>
            When a round sells out, the contract makes one request to{" "}
            <a href={DICE_SITE} target="_blank" rel="noreferrer">
              Dice Protocol <Arrow out />
            </a>
            . Dice returns a random number; the contract turns it into one shuffle that gives every pack exactly one
            prize. Anyone can recompute the shuffle from the stored seed. When a round is done, anyone can start the
            next one; its prizes come from a reserve already held by the contract.
          </p>
          <p>
            Dice is a commit-reveal oracle with a single provider, not a VRF. The provider knows its values in advance,
            so it could withhold a reveal or steer which pack gets which prize. If no reveal arrives within four hours,
            the round is cancelled and every pack is refunded, and the next round waits for the owner. This is why Packs
            stay on testnet. Read{" "}
            <a href={DICE_DOCS} target="_blank" rel="noreferrer">
              Dice’s documentation <Arrow out />
            </a>{" "}
            for its trust model.
          </p>
        </aside>
      )}
    </section>
  );
}
