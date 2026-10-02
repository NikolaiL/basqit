"use client";

import { useEffect, useRef, useState } from "react";
import { deployment, formatToken, usePacksWrite, useTokens } from "./usePacks";
import { AddressInput } from "@scaffold-ui/components";
import { useQuery } from "@tanstack/react-query";
import { type Address, isAddress, parseAbiItem } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { DialogClose } from "~~/components/DialogClose";
import { StockLogo } from "~~/components/StockLogo";
import { SwapConfetti } from "~~/components/trading/SwapConfetti";
import { packsClient, packsTestnet, robinhoodTestnet } from "~~/services/packs/testnet";
import { getParsedError } from "~~/utils/scaffold-eth";

type Item = { token: Address; amount: bigint };

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** Unopened gifts held by the connected wallet, shown first so a recipient finds them straight away. */
export function SealedGifts() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const write = usePacksWrite();
  const tokens = useTokens();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<{ id: bigint; contents: Item[] }>();
  const gifts = { address: deployment.gifts, abi: deployment.abis.gifts } as const;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (opened) dialog.current?.showModal();
  }, [opened]);
  // Passing a sealed gift on: it moves as it is, still sealed, to the new holder.
  const [sending, setSending] = useState<bigint>();
  const [to, setTo] = useState("");
  const [sent, setSent] = useState<{ id: bigint; to: string }>();
  const sendDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (sending !== undefined) sendDialog.current?.showModal();
  }, [sending]);

  // Every Transfer to this wallet since deploy, still owned by it.
  const mine = useQuery({
    queryKey: ["packs-gift-mine", address],
    enabled: !!packsTestnet && !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const logs = await packsClient.getLogs({
        address: deployment.gifts,
        event: transferEvent,
        args: { to: address },
        fromBlock: BigInt(deployment.deployBlock),
      });
      const ids = [...new Set(logs.map(log => log.args.tokenId!))];
      const held = await Promise.all(
        ids.map(async id => {
          const owner = await packsClient
            .readContract({ ...gifts, functionName: "ownerOf", args: [id] })
            .catch(() => null);
          if ((owner as string | null)?.toLowerCase() !== address!.toLowerCase()) return null;
          // Read now: once opened the gift is burned and its contents can no longer be read.
          const contents = (await packsClient.readContract({
            ...gifts,
            functionName: "contentsOf",
            args: [id],
          })) as Item[];
          return { id, contents };
        }),
      );
      return held.filter(gift => gift !== null);
    },
  });

  const sealed = mine.data ?? [];
  const sendable = (value: string) => {
    const target = value.trim().toLowerCase();
    return isAddress(target) && target !== address?.toLowerCase() && target !== deployment.gifts.toLowerCase();
  };
  if (!sealed.length && !opened && !sent) return null;
  const onTestnet = chainId === robinhoodTestnet.id;
  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(getParsedError(failure));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="bq-sealed" aria-labelledby="bq-sealed-title">
      {sealed.length > 0 && (
        <>
          <h2 id="bq-sealed-title">
            {sealed.length === 1 ? "You have a gift waiting" : `You have ${sealed.length} gifts waiting`}{" "}
            <span className="bq-sealed-net">on testnet</span>
          </h2>
          <p className="bq-sealed-note">
            Robinhood Chain testnet. The Stock Tokens inside are test tokens with no value.
          </p>
          <ul>
            {sealed.map(gift => (
              <li key={String(gift.id)}>
                {/* The contents stay a surprise until opened, even though they are public on-chain. */}
                <span>
                  <b>Gift #{String(gift.id)}</b> Sealed. Open it to see what&apos;s inside.
                </span>
                {onTestnet ? (
                  <div className="bq-sealed-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!!busy}
                      onClick={() =>
                        run(`open-${gift.id}`, async () => {
                          await write({ ...gifts, functionName: "open", args: [gift.id] }, { celebrate: false });
                          setOpened(gift);
                        })
                      }
                    >
                      {busy === `open-${gift.id}` ? "Opening…" : "Open"}
                    </button>
                    <button
                      type="button"
                      className="bq-sealed-pass"
                      disabled={!!busy}
                      onClick={() => (setTo(""), setSending(gift.id))}
                    >
                      Send it to someone else
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!!busy}
                    onClick={() => run("switch", () => switchChainAsync({ chainId: robinhoodTestnet.id }))}
                  >
                    Switch to testnet to open
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {sent && (
        <p className="bq-sealed-sent" role="status">
          Gift #{String(sent.id)} is on its way to {sent.to.slice(0, 6)}…{sent.to.slice(-4)}, still sealed.
        </p>
      )}
      {sending !== undefined && (
        <dialog
          ref={sendDialog}
          className="modal"
          aria-labelledby="bq-gift-send-title"
          onClose={() => setSending(undefined)}
        >
          <div className="modal-box bq-sealed-send">
            <DialogClose label="Close" disabled={!!busy} onClick={() => sendDialog.current?.close()} />
            <h2 id="bq-gift-send-title">Send gift #{String(sending)}</h2>
            <p>
              It stays sealed. The new holder opens it on this page with the wallet you send it to, on Robinhood Chain
              testnet.
            </p>
            <label>
              Their wallet address
              <AddressInput value={to} onChange={setTo} placeholder="0x…" />
            </label>
            {to.trim() && !sendable(to) && <p className="bq-demo-error">Enter a different wallet address.</p>}
            <button
              className="btn btn-primary btn-sm"
              disabled={!sendable(to) || !!busy}
              onClick={() =>
                run("send", async () => {
                  const id = sending;
                  await write({ ...gifts, functionName: "safeTransferFrom", args: [address, to.trim(), id] });
                  setSent({ id, to: to.trim() });
                  sendDialog.current?.close();
                })
              }
            >
              {busy === "send" ? "Sending…" : "Send gift"}
            </button>
          </div>
        </dialog>
      )}
      {opened && (
        <dialog
          ref={dialog}
          className="modal"
          aria-labelledby="bq-gift-opened-title"
          onClose={() => setOpened(undefined)}
        >
          <div className="modal-box bq-sealed-opened" role="status">
            <DialogClose label="Close" onClick={() => dialog.current?.close()} />
            <h2 id="bq-gift-opened-title">Gift #{String(opened.id)} is open</h2>
            <ul>
              {opened.contents.map((item, i) => {
                const token = tokens.data?.[item.token.toLowerCase()];
                return (
                  <li key={item.token} style={{ animationDelay: `${i * 120}ms` }}>
                    <StockLogo symbol={token?.ticker ?? ""} size={48} />
                    <b>{token ? formatToken(item.amount, token.decimals) : "…"}</b>
                    <span>{token?.symbol}</span>
                  </li>
                );
              })}
            </ul>
            <p>All of it is in your wallet now.</p>
            <button className="btn btn-primary btn-sm" onClick={() => dialog.current?.close()}>
              Done
            </button>
          </div>
          <SwapConfetti
            key={String(opened.id)}
            symbols={opened.contents.map(item => tokens.data?.[item.token.toLowerCase()]?.ticker ?? "")}
          />
        </dialog>
      )}
      {error && (
        <p className="bq-demo-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
