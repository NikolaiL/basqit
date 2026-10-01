"use client";

import { useState } from "react";
import {
  deadlineIn,
  demoError,
  deployment,
  ensureAllowance,
  formatToken,
  usePacksWrite,
  useTestUsdg,
  useTokens,
} from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { type Address, erc20Abi, formatUnits, isAddress, parseUnits, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { packsClient, robinhoodTestnet, testnetAssets } from "~~/services/packs/testnet";

type Item = { token: Address; amount: bigint };

// Ready-made mixes: dollars per company, bought at the current price like any gift you build.
const MIXES = [
  { name: "Tech Giants", dollars: { AAPL: 7, AMZN: 7, META: 7 } },
  { name: "Chips & Cars", dollars: { NVDA: 12, TSLA: 7 } },
] as const;

export function GiftsDemo() {
  const { address, chainId } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const [friend, setFriend] = useState("");
  const [busy, setBusy] = useState("");
  // Custom gift: dollars per company when buying, token amounts when wrapping what you hold.
  const [mode, setMode] = useState<"buy" | "wrap">("buy");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const ready = !!address && chainId === robinhoodTestnet.id;

  const gifts = { address: deployment.gifts, abi: deployment.abis.gifts } as const;
  const router = { address: deployment.giftRouter, abi: deployment.abis.giftRouter } as const;
  const shop = useQuery({
    queryKey: ["packs-gift-shop", address],
    refetchInterval: 15_000,
    queryFn: async () => {
      const feeBps = (await packsClient.readContract({ ...router, functionName: "feeBps" })) as number;
      const rows = await Promise.all(
        (await testnetAssets()).stocks.map(async token => {
          const [price, stock, balance] = await Promise.all([
            packsClient.readContract({
              address: deployment.swapAdapter,
              abi: deployment.abis.swapAdapter,
              functionName: "priceUsdG",
              args: [token],
            }) as Promise<bigint>,
            packsClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [deployment.swapAdapter],
            }),
            address
              ? packsClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] })
              : Promise.resolve(0n),
          ]);
          return { token, price, stock, balance };
        }),
      );
      return { feeBps: BigInt(feeBps), rows };
    },
  });

  // The last failure and the action it belongs to, shown right under that action.
  const [failed, setFailed] = useState<{ at: string; message: string }>();
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
  const errorAt = (label: string) =>
    failed?.at === label ? (
      <p className="bq-demo-error" role="alert">
        {failed.message}
      </p>
    ) : null;
  const usdgBalance = useTestUsdg(address).data;
  // Checked before the wallet opens; the contract still enforces it if the balance changes in between.
  const cannotPay = (total: bigint) => !!address && usdgBalance !== undefined && usdgBalance < total;
  const recipient = (friend.trim() || address) as Address;
  // The gift contracts can never pass a gift on, so a gift sent there is lost.
  const friendInvalid =
    !!friend.trim() &&
    (!isAddress(friend.trim()) ||
      [zeroAddress, deployment.gifts, deployment.giftRouter].some(
        a => a.toLowerCase() === friend.trim().toLowerCase(),
      ));
  // No rows until prices load: an unknown price must never read as a free gift.
  const rows = shop.data?.rows ?? [];
  const legCost = (token: Address, amount: bigint) => {
    const price = rows.find(entry => entry.token === token)?.price ?? 0n;
    return (amount * price + 10n ** 18n - 1n) / 10n ** 18n;
  };

  // Dollars become token amounts at the current price; wrap amounts are taken as typed.
  // Anything typed that is not a usable amount stays in the list as invalid, so it can never vanish from the gift.
  const itemsFrom = (values: Record<string, string>, as: "buy" | "wrap") =>
    rows.flatMap(({ token, price, stock, balance }) => {
      const raw = (values[token] ?? "").trim();
      if (!raw) return [];
      const decimals = tokens.data?.[token.toLowerCase()]?.decimals ?? 18;
      const invalid = { token, amount: 0n, over: false, invalid: true };
      // Precision beyond the token's decimals would be rounded silently, so it is rejected like any other typo.
      const places = raw.split(".")[1]?.length ?? 0;
      if (!/^(\d+\.?\d*|\.\d+)$/.test(raw) || places > (as === "buy" ? 6 : decimals) || (as === "buy" && price === 0n))
        return [invalid];
      const amount = as === "buy" ? (parseUnits(raw, 6) * 10n ** 18n) / price : parseUnits(raw, decimals);
      if (amount === 0n) return /[1-9]/.test(raw) ? [invalid] : [];
      return [{ token, amount, over: as === "buy" ? amount > stock : amount > balance, invalid: false }];
    });
  const totalOf = (items: Item[]) => {
    const spent = items.reduce((sum, item) => sum + legCost(item.token, item.amount), 0n);
    const fee = (spent * (shop.data?.feeBps ?? 0n) + 9_999n) / 10_000n;
    return { spent, fee, total: spent + fee };
  };
  const picked = itemsFrom(inputs, mode);
  const { total, fee } = totalOf(picked);
  const canBuild =
    ready && !friendInvalid && !busy && picked.length > 0 && picked.every(item => !item.over && !item.invalid);
  const itemLabel = (item: Item) => {
    const token = tokens.data?.[item.token.toLowerCase()];
    return token ? `${formatToken(item.amount, token.decimals)} ${token.symbol}` : "…";
  };
  const tokenOf = (ticker: string) =>
    Object.values(tokens.data ?? {}).find(token => token.ticker === ticker && token.symbol !== "tUSDG")?.address;

  /** Buys the items through the router and seals them for the recipient, in one transaction. */
  const buy = async (items: Item[]) => {
    const { total: budget } = totalOf(items);
    await ensureAllowance(write, address!, (await testnetAssets()).usdg, deployment.giftRouter, budget);
    const purchases = items.map(item => ({
      token: item.token,
      amount: item.amount,
      adapter: deployment.swapAdapter,
      maxAmountIn: legCost(item.token, item.amount),
      routeData: "0x",
    }));
    const deadline = deadlineIn(20);
    // Pins the fee and the gifts contract the buyer saw, so neither can change under them.
    const maxFeeBps = Number(shop.data?.feeBps ?? 0n);
    await write({
      ...router,
      functionName: "buyGift",
      args: [purchases, budget, maxFeeBps, deployment.gifts, recipient, deadline],
    });
  };

  return (
    <section className="bq-demo-block">
      <h3>Gifts</h3>
      <p className="bq-demo-note">
        Stock Tokens bought at the current price and sealed in a gift. Buy one for yourself or send it to a friend.
      </p>
      <label className="bq-demo-friend">
        Send to a friend (optional)
        <input
          className="input"
          placeholder="0x… friend’s address"
          value={friend}
          onChange={event => setFriend(event.target.value)}
          aria-invalid={friendInvalid}
          aria-describedby={friendInvalid ? "gift-friend-error" : undefined}
        />
      </label>
      {friendInvalid && (
        <p id="gift-friend-error" className="bq-demo-error" role="alert">
          Enter a wallet address (0x followed by 40 characters). Gift contracts and the zero address cannot hold gifts.
        </p>
      )}
      <article className="bq-demo-card bq-demo-builder">
        <strong>Build your own</strong>
        <div className="bq-tabs" role="tablist" aria-label="How to fill the gift">
          <button
            role="tab"
            aria-selected={mode === "buy"}
            className={`btn btn-sm ${mode === "buy" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => (setMode("buy"), setInputs({}))}
          >
            Buy with tUSDG
          </button>
          <button
            role="tab"
            aria-selected={mode === "wrap"}
            className={`btn btn-sm ${mode === "wrap" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => (setMode("wrap"), setInputs({}))}
          >
            Wrap tokens you hold
          </button>
        </div>
        <ul className="bq-demo-builder-rows">
          {rows
            .filter(entry => mode === "buy" || entry.balance > 0n)
            .map(({ token, price, balance }) => {
              const info = tokens.data?.[token.toLowerCase()];
              const item = picked.find(entry => entry.token === token);
              return (
                <li key={token}>
                  <StockLogo symbol={info?.ticker ?? ""} size={28} />
                  <span>
                    <b>{info?.symbol ?? "…"}</b>
                    {/* One line either way, so typing never makes the form taller. */}
                    <small>
                      {mode === "buy"
                        ? `$${Number(formatUnits(price, 6)).toFixed(2)} each`
                        : `You hold ${info ? formatToken(balance, info.decimals) : "…"}`}
                      {item &&
                        (item.invalid ? (
                          <em className="is-over"> · enter an amount like 5 or 2.5</em>
                        ) : item.over ? (
                          <em className="is-over">
                            {mode === "buy" ? " · not enough available" : " · more than you hold"}
                          </em>
                        ) : (
                          mode === "buy" && <em> · {itemLabel(item)}</em>
                        ))}
                    </small>
                  </span>
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder={mode === "buy" ? "$0" : "0"}
                    aria-label={mode === "buy" ? `Dollars of ${info?.symbol}` : `Amount of ${info?.symbol}`}
                    aria-invalid={item?.over || item?.invalid}
                    value={inputs[token] ?? ""}
                    onChange={event => setInputs(current => ({ ...current, [token]: event.target.value }))}
                  />
                </li>
              );
            })}
        </ul>
        {shop.isPending && <p className="bq-demo-note">Loading current prices…</p>}
        {shop.isError && !shop.data && (
          <p className="bq-demo-note" role="alert">
            Prices could not be loaded.{" "}
            <button className="btn btn-link btn-xs" onClick={() => void shop.refetch()}>
              Retry
            </button>
          </p>
        )}
        {mode === "wrap" && shop.data && !rows.some(entry => entry.balance > 0n) && (
          <p className="bq-demo-note">This wallet holds none of the listed Stock Tokens.</p>
        )}
        {mode === "buy" && fee > 0n && <p className="bq-demo-note">Includes a {formatToken(fee, 6)} tUSDG fee.</p>}
        <button
          className="btn btn-primary btn-sm"
          disabled={!canBuild || (mode === "buy" && cannotPay(total))}
          onClick={() =>
            act("custom", async () => {
              const items = picked.map(({ token, amount }) => ({ token, amount }));
              if (mode === "buy") await buy(items);
              else {
                for (const item of items)
                  await ensureAllowance(write, address!, item.token, deployment.gifts, item.amount);
                await write({ ...gifts, functionName: "wrap", args: [items, recipient] });
              }
              setInputs({});
            })
          }
          aria-describedby="gift-review"
        >
          {busy === "custom"
            ? "Sealing…"
            : mode === "buy" && picked.length && cannotPay(total)
              ? "Not enough tUSDG"
              : mode === "buy"
                ? `${friend.trim() ? "Send" : "Buy"} for ${formatToken(total, 6)} tUSDG`
                : friend.trim()
                  ? "Wrap and send"
                  : "Wrap for yourself"}
        </button>
        {errorAt("custom")}
        {mode === "buy" && picked.length > 0 && cannotPay(total) && (
          <p className="bq-demo-note">
            You have {formatToken(usdgBalance ?? 0n, 6)} tUSDG. Get free test USDG in step 3 above.
          </p>
        )}
        {ready && !friendInvalid && (
          <p id="gift-review" className="bq-demo-note">
            Recipient {recipient === address ? "you" : `${recipient.slice(0, 6)}…${recipient.slice(-4)}`} · Robinhood
            Chain testnet · test tokens with no value
          </p>
        )}
      </article>
      <div className="bq-demo-grid">
        {MIXES.map(mix => {
          const values = Object.fromEntries(
            Object.entries(mix.dollars).flatMap(([ticker, dollars]) => {
              const token = tokenOf(ticker);
              return token ? [[token, String(dollars)]] : [];
            }),
          );
          const items = itemsFrom(values, "buy");
          const price = totalOf(items).total;
          return (
            <article key={mix.name} className="bq-demo-card">
              <strong>{mix.name}</strong>
              <ul className="bq-demo-items">
                {items.map(item => (
                  <li key={item.token}>
                    <StockLogo symbol={tokens.data?.[item.token.toLowerCase()]?.ticker ?? ""} size={24} />
                    {itemLabel(item)}
                  </li>
                ))}
              </ul>
              <p className="bq-demo-price">
                {shop.data ? <>{formatToken(price, 6)} tUSDG at today&apos;s prices</> : "Loading prices…"}
              </p>
              <button
                className="btn btn-primary btn-sm"
                disabled={
                  !ready ||
                  friendInvalid ||
                  !!busy ||
                  !items.length ||
                  items.some(item => item.over || item.invalid) ||
                  cannotPay(price)
                }
                onClick={() => act(`mix-${mix.name}`, () => buy(items.map(({ token, amount }) => ({ token, amount }))))}
              >
                {busy === `mix-${mix.name}`
                  ? "Buying…"
                  : cannotPay(price)
                    ? "Not enough tUSDG"
                    : friend.trim()
                      ? "Send as a gift"
                      : "Buy for yourself"}
              </button>
              {errorAt(`mix-${mix.name}`)}
            </article>
          );
        })}
      </div>
    </section>
  );
}
