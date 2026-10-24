"use client";

import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import Link from "next/link";
import "./packs2.css";
import { Address } from "@scaffold-ui/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Address as EthAddress, type Hex, formatUnits, parseEventLogs, parseUnits } from "viem";
import { foundry } from "viem/chains";
import { useAccount, useBalance, useBlock, useSwitchChain } from "wagmi";
import { Arrow } from "~~/components/Arrow";
import { LoadingBars } from "~~/components/LoadingBars";
import { StockLogo } from "~~/components/StockLogo";
import { PackFace } from "~~/components/packs2/PackFace";
import { PackReveal, type RevealLevel } from "~~/components/packs2/PackReveal";
import { formatToken, formatUsd, useUsdPrices } from "~~/components/packs/usePacks";
import { WaitlistForm } from "~~/components/waitlist/WaitlistForm";
import packs2Contracts from "~~/contracts/packs2Contracts";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import {
  PACK_TYPES,
  type StockOption,
  averagePayout,
  packPresentation,
  rankedPayouts,
} from "~~/services/packs/catalog";
import { fetchDrandProof } from "~~/services/packs/drand";
import { faucetAvailability } from "~~/services/packs/faucet";
import { type PackPayout, confirmedPayouts } from "~~/services/packs/reveal";
import { PACK_STOCKS, packStocks, payoutStock } from "~~/services/packs/stocks";
import { TESTNET_ETH_FAUCET, robinhoodTestnet } from "~~/services/packs/testnet";
import { getParsedError } from "~~/utils/scaffold-eth";

const network = process.env.NODE_ENV === "development" ? foundry : robinhoodTestnet;
const readOptions = { chainId: network.id, watch: false, query: { refetchInterval: 5000 } } as const;
const registry = packs2Contracts as Record<number, Record<string, { address: EthAddress }>>;
const registered = registry[network.id];
const stocks = packStocks(registered);
const stockInfo = (token: EthAddress) => payoutStock(token, stocks);
type Vaults = Record<string, bigint | undefined>;

function useStockVault(contractName: (typeof PACK_STOCKS)[number]["contract"]) {
  return useScaffoldReadContract({
    ...readOptions,
    contractName,
    functionName: "balanceOf",
    args: [registered?.BasqitPacks2.address],
    query: { enabled: !!registered?.[contractName], refetchInterval: 5000 },
  }).data;
}
const rarity = [
  { name: "Common", color: "#7b899e" },
  { name: "Uncommon", color: "#3b8c79" },
  { name: "Rare", color: "#3977c4" },
  { name: "Epic", color: "var(--bq-brand)" },
  { name: "Legendary", color: "#bb7400" },
];
type Tier = { token: EthAddress; amount: bigint; end: number };
type PackConfig = { price: bigint; referencePriceUsdG: bigint; tiers: readonly Tier[] };
function levelInfo(index: number, length: number) {
  return length === 5 ? rarity[index] : { name: `Level ${index + 1}`, color: rarity[index % rarity.length].color };
}
type Payout = PackPayout;
type Opening = {
  recipient: EthAddress;
  round: bigint;
  quantity: number;
  revealed: boolean;
  seed: Hex;
  claimed: bigint;
};

function TxButton({
  children,
  pending,
  disabled,
  action,
}: {
  children: ReactNode;
  pending: string;
  disabled?: boolean;
  action: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const client = useQueryClient();
  return (
    <div>
      <button
        className="btn btn-primary btn-sm"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            await action();
            await client.invalidateQueries({ queryKey: ["readContract"] });
          } catch (failure) {
            setError(getParsedError(failure));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <LoadingBars small /> {pending}
          </>
        ) : (
          children
        )}
      </button>
      {error && (
        <p className="bq-demo-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Packs2() {
  const { address } = useAccount();
  return (
    <main className="bq-dashboard bq-packs2">
      <header className="bq-packs2-intro">
        <div>
          <p className="bq-soon-status">Packs · Test tokens only</p>
          <h1 className="bq-page-title">A little pack. A piece of the market.</h1>
          <p>Pick a pack, reveal your Stock Tokens, and collect. Every opening is a new selection.</p>
        </div>
        <Link href="/packs_old" className="link">
          Original demo
        </Link>
      </header>
      <section className="bq-packs2-invites" aria-labelledby="packs-invites-title">
        <div>
          <span className="badge badge-outline">The pack list</span>
          <h2 id="packs-invites-title">Free test-pack invites. By email.</h2>
          <p>Be first to hear about future free test-pack drops.</p>
        </div>
        <WaitlistForm
          product="packs"
          cta="Your email"
          buttonLabel="Get pack invites"
          successMessage="You’re on the list. Watch your inbox for future free test-pack invitations."
          note="Free test-pack invitations and Basqit launch news. Unsubscribe any time."
          confetti={["NVDA"]}
        />
      </section>
      {registered?.BasqitPacks2 ? (
        <Packs2Live key={address ?? "disconnected"} />
      ) : (
        <section className="bq-demo-block alert">
          The Packs contract has not been configured on {network.name} yet. The experiment is not accepting payments
          here.
        </section>
      )}
      <p className="bq-soon-fine">
        Test tokens have no value. Public paid Packs remain subject to legal review. Pending payouts have no automatic
        refund or guaranteed funding deadline.
      </p>
    </main>
  );
}

function TestUsdgFaucet({ ready }: { ready: boolean }) {
  const { address } = useAccount();
  const { data: block } = useBlock({ chainId: network.id, query: { refetchInterval: 3000 } });
  const immutable = { chainId: network.id, watch: false, query: { staleTime: Infinity } } as const;
  const { data: amount } = useScaffoldReadContract({
    ...immutable,
    contractName: "Packs2PaymentFaucet",
    functionName: "amount",
  });
  const { data: cooldown } = useScaffoldReadContract({
    ...immutable,
    contractName: "Packs2PaymentFaucet",
    functionName: "cooldown",
  });
  const { data: dailyCap } = useScaffoldReadContract({
    ...immutable,
    contractName: "Packs2PaymentFaucet",
    functionName: "dailyCap",
  });
  const { data: lastDrip } = useScaffoldReadContract({
    ...readOptions,
    contractName: "Packs2PaymentFaucet",
    functionName: "lastDrip",
    args: [address],
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: minted } = useScaffoldReadContract({
    ...readOptions,
    contractName: "Packs2PaymentFaucet",
    functionName: "mintedOnDay",
    args: [block ? block.timestamp / 86400n : undefined],
  });
  const faucet = useScaffoldWriteContract({ contractName: "Packs2PaymentFaucet", chainId: network.id });
  const status =
    block &&
    amount !== undefined &&
    cooldown !== undefined &&
    dailyCap !== undefined &&
    lastDrip !== undefined &&
    minted !== undefined
      ? faucetAvailability({ now: block.timestamp, amount, cooldown, dailyCap, lastDrip, minted })
      : undefined;
  return (
    <div>
      <TxButton
        pending="Getting test USDG…"
        disabled={!ready || !status?.ready}
        action={() => faucet.writeContractAsync({ functionName: "drip" })}
      >
        {status?.capped
          ? "Daily faucet limit reached"
          : status?.wait
            ? `Refill in ${status.wait}s`
            : amount === undefined
              ? "Checking test faucet…"
              : `Get ${formatToken(amount, 6)} test USDG`}
      </TxButton>
      <p className="bq-demo-note" role="status">
        {amount === undefined || cooldown === undefined
          ? "Loading faucet limits…"
          : `${formatToken(amount, 6)} test USDG per refill, every ${cooldown} seconds.`}
        {status?.wait ? " Your refill becomes available automatically when the cooldown ends." : ""}
        {status?.capped ? " The shared daily allocation is used up. It resets at the next UTC day." : ""}
      </p>
    </div>
  );
}

function Packs2Live() {
  const { address, chainId } = useAccount();
  const { data: gasBalance } = useBalance({
    address,
    chainId: network.id,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useWalletConnectModal();
  const { data: deployed, isLoading } = useDeployedContractInfo({ contractName: "BasqitPacks2", chainId: network.id });
  const [quantity, setQuantity] = useState("1");
  const [selectedTier, setSelectedTier] = useState(4);
  const [packType, setPackType] = useState(1);
  const [fundingStock, setFundingStock] = useState(0);
  const fundingAsset = PACK_STOCKS[fundingStock];
  const fundingToken = registered?.[fundingAsset.contract]?.address;
  const [funding, setFunding] = useState("0.01");
  const [offset, setOffset] = useState(0);
  const [activeOpening, setActiveOpening] = useState<bigint>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const payment = useScaffoldWriteContract({ contractName: "Packs2PaymentToken", chainId: network.id });
  const stock = useScaffoldWriteContract({ contractName: fundingAsset.contract, chainId: network.id });
  const core = useScaffoldWriteContract({ contractName: "BasqitPacks2", chainId: network.id });
  const stockFaucet = useScaffoldWriteContract({ contractName: fundingAsset.faucet, chainId: network.id });
  const query = { enabled: !!deployed, refetchInterval: 5000 };
  const { data: configId } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "currentConfigId",
    args: [packType],
    query,
  });
  const { data: configData } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "packConfig",
    args: [configId],
    query: { enabled: !!deployed && !!configId, refetchInterval: false },
  });
  const config = configData as PackConfig | undefined;
  const price = config?.price;
  const referencePrice = config?.referencePriceUsdG;
  const pack = price === undefined ? PACK_TYPES[packType - 1] : packPresentation(price);
  const purchaseBusy = core.isPending || core.isMining || payment.isPending || payment.isMining;
  const { data: paused } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "opensPaused",
    query,
  });
  const { data: references } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "packReferencePrices",
    args: [configId],
    query: { enabled: !!configId, refetchInterval: false },
  });
  const {
    data: poolData,
    error: poolError,
    refetch: refetchPool,
  } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "stockPool",
    args: [configId],
    query: { enabled: !!configId, refetchInterval: false },
  });
  const pool = poolData as readonly StockOption[] | undefined;
  const illustrative = !!pool?.length;
  const { data: liabilities } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "liabilities",
    args: [fundingToken],
    query,
  });
  const nvdaVault = useStockVault("Packs2StockToken");
  const aaplVault = useStockVault("Packs2StockAAPL");
  const msftVault = useStockVault("Packs2StockMSFT");
  const amznVault = useStockVault("Packs2StockAMZN");
  const tslaVault = useStockVault("Packs2StockTSLA");
  const balances = [nvdaVault, aaplVault, msftVault, amznVault, tslaVault];
  const vaults: Vaults = Object.fromEntries(
    PACK_STOCKS.flatMap((stock, i) =>
      registered?.[stock.contract] ? [[registered[stock.contract].address.toLowerCase(), balances[i]]] : [],
    ),
  );
  const vault = fundingToken ? vaults[fundingToken.toLowerCase()] : undefined;
  const { data: faucetAmount } = useScaffoldReadContract({
    ...readOptions,
    contractName: fundingAsset.faucet,
    functionName: "amount",
    query: { enabled: !!fundingToken, refetchInterval: false },
  });
  const walletQuery = { enabled: !!deployed && !!address, refetchInterval: 5000 };
  const { data: balance } = useScaffoldReadContract({
    ...readOptions,
    contractName: "Packs2PaymentToken",
    functionName: "balanceOf",
    args: [address],
    query: walletQuery,
  });
  const { data: allowance } = useScaffoldReadContract({
    ...readOptions,
    contractName: "Packs2PaymentToken",
    functionName: "allowance",
    args: [address, registered.BasqitPacks2.address],
    query: walletQuery,
  });
  const { data: stockBalance } = useScaffoldReadContract({
    ...readOptions,
    contractName: fundingAsset.contract,
    functionName: "balanceOf",
    args: [address],
    query: walletQuery,
  });
  const { data: stockAllowance } = useScaffoldReadContract({
    ...readOptions,
    contractName: fundingAsset.contract,
    functionName: "allowance",
    args: [address, registered.BasqitPacks2.address],
    query: walletQuery,
  });
  const { data: ids } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "openingIds",
    args: [address, BigInt(offset), 5n],
    query: walletQuery,
  });
  const prices = useUsdPrices(stocks.map(stock => stock.ticker));
  const tokenPrices = Object.fromEntries(
    stocks.map(stock => [stock.address.toLowerCase(), prices.data?.[stock.ticker]]),
  );
  const amountLabel = (amount: bigint, token: EthAddress = fundingToken) => {
    const stock = stockInfo(token);
    const usd = tokenPrices[token.toLowerCase()];
    return `${formatUnits(amount, 18)} t${stock.ticker} · ${usd ? `${formatUsd((Number(amount) / 1e18) * usd)} reference value` : "USD reference unavailable"}`;
  };
  const count = /^\d+$/.test(quantity) ? Number(quantity) : 0;
  const validCount = Number.isSafeInteger(count) && count >= 1 && count <= 100;
  const cost = BigInt(validCount ? count : 0) * (price ?? 0n);
  let fundAmount = 0n;
  try {
    if (/^\d+(\.\d{1,18})?$/.test(funding)) fundAmount = parseUnits(funding, 18);
  } catch {
    /* Invalid input stays disabled. */
  }
  const ready = !!address && chainId === network.id && !!deployed;
  const tiers = config?.tiers;
  const ownIds = ids as readonly bigint[] | undefined;

  if (!deployed)
    return (
      <section className="alert">
        {isLoading
          ? "Checking the Packs deployment…"
          : `Packs is unavailable on ${network.name}. Start its deployment before using this experiment.`}
      </section>
    );

  const packPrice = price === undefined ? undefined : Number(price) / 1e6;
  const average = tiers && pool ? averagePayout(tiers, tokenPrices, pool) : undefined;
  const sortingPrices = { ...tokenPrices };
  tiers?.forEach((tier, index) => {
    if (!sortingPrices[tier.token.toLowerCase()])
      sortingPrices[tier.token.toLowerCase()] = Number(references?.[index] || referencePrice || 0n) / 1e6 || undefined;
  });
  const cards = tiers && pool !== undefined ? rankedPayouts(tiers, sortingPrices) : [];
  const currentReturn = average !== undefined && packPrice ? (average / packPrice) * 100 : undefined;
  const calibrationPrices: Record<string, number | undefined> = {};
  tiers?.forEach((tier, index) => {
    calibrationPrices[tier.token.toLowerCase()] =
      Number(references?.[index] || referencePrice || 0n) / 1e6 || undefined;
  });
  pool?.forEach(stock => {
    calibrationPrices[stock.token.toLowerCase()] = Number(stock.referencePriceUsdG) / 1e6 || undefined;
  });
  const calibrationAverage = tiers && pool ? averagePayout(tiers, calibrationPrices, pool) : undefined;
  const calibratedReturn =
    calibrationAverage !== undefined && packPrice ? ((calibrationAverage / packPrice) * 100).toFixed(0) : undefined;
  const preview = tiers?.[selectedTier];
  const tierInfo = (index: number) => levelInfo(index, tiers?.length ?? 0);
  const revealLevels =
    tiers?.map((tier, index) => ({ end: tier.end, token: tier.token, amount: tier.amount, ...tierInfo(index) })) ?? [];

  return (
    <section className="bq-demo-block" aria-label="Packs experiment">
      <section id="testnet" className="bq-demo bq-packs2-testnet" aria-labelledby="packs-testnet-title">
        <h2 id="packs-testnet-title">Try Packs on testnet</h2>
        <p className="bq-soon-status">Testnet · Test tokens only</p>
        <p className="bq-demo-lead">
          Everything below runs on {network.name} with test tokens that have no value. Packs use{" "}
          <a href="https://docs.drand.love/developer/" target="_blank" rel="noreferrer">
            drand evmnet <Arrow out />
          </a>{" "}
          for verifiable randomness. Reveal your result, then collect your Stock Tokens.
        </p>
        <ol className="bq-demo-steps">
          <li>
            <strong>{network.id === 31337 ? "Connect on local fork" : "Connect on testnet"}</strong>
            {!address ? (
              <button className="btn btn-primary btn-sm" onClick={openConnectModal}>
                Connect wallet
              </button>
            ) : ready ? (
              <span className="bq-demo-ok">Connected to {network.name}</span>
            ) : (
              <TxButton pending="Switching…" action={() => switchChainAsync({ chainId: network.id })}>
                Switch to {network.name}
              </TxButton>
            )}
          </li>
          <li>
            <strong>Get test ETH for gas</strong>
            <span>
              {gasBalance ? `${formatToken(gasBalance.value, 18)} ETH · ` : address ? "Loading ETH balance… · " : ""}
              {network.id === 31337 ? (
                "Use a funded local Anvil wallet."
              ) : (
                <a href={TESTNET_ETH_FAUCET} target="_blank" rel="noreferrer">
                  Robinhood testnet faucet <Arrow out />
                </a>
              )}
            </span>
          </li>
          <li>
            <strong>Get test USDG</strong>
            <span>{balance === undefined ? "— tUSDG" : `${formatToken(balance, 6)} tUSDG`}</span>
            <TestUsdgFaucet ready={ready} />
          </li>
        </ol>
      </section>
      <div className="bq-packs2-columns">
        <section
          className="bq-packs2-preview"
          aria-label={`${pack.name} pack preview`}
          style={{ "--pack-color": pack.color } as CSSProperties}
        >
          <div className="bq-packs2-preview-label">
            <span>STOCK TOKENS</span>
            <span>
              {String(packType).padStart(2, "0")} / {pack.name.toUpperCase()}
            </span>
          </div>
          <div className="bq-packs2-stage">
            <div className="bq-packs2-ticket bq-packs2-ticket-back" aria-hidden="true">
              <span>{pack.name.toUpperCase()} EDITION</span>
            </div>
            <div className="bq-packs2-ticket bq-packs2-ticket-front">
              <PackFace pack={pack} stocks={stocks} />
            </div>
          </div>
          <div className="bq-packs2-preview-caption">
            <span>One pack. {tiers?.length ?? "…"} possible payout levels.</span>
            <strong>
              {pool === undefined
                ? "Loading eligible payouts…"
                : preview
                  ? `${tierInfo(selectedTier).name} ${illustrative ? "example" : "preview"} · ${amountLabel(preview.amount, preview.token)}`
                  : "Loading payout preview…"}
            </strong>
            <small>
              {illustrative
                ? "Illustrative stock and amount. Your actual result is selected on reveal."
                : "Select a reward below to preview it. This is not an opening result."}
            </small>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!tiers?.length || pool === undefined}
              onClick={() => setPreviewOpen(true)}
            >
              Try the opening animation ↗
            </button>
          </div>
        </section>
        <section className="bq-packs2-panel bq-packs2-controls">
          <div className="bq-packs2-control-title">
            <div>
              <p className="bq-packs2-eyebrow">{pack.name.toUpperCase()} EDITION · STOCK TOKENS</p>
              <h2>{price === undefined ? "Choose a pack" : `${pack.name} · ${formatToken(price, 6)} tUSDG`}</h2>
            </div>
            <span className="badge badge-outline">
              {calibratedReturn ? `${calibratedReturn}% target return` : "Published payout table"}
            </span>
          </div>
          <p className="bq-demo-note">A fixed price. A variable amount of test Stock Tokens.</p>
          <div className="bq-packs2-type-grid" aria-label="Pack price">
            {PACK_TYPES.map(option => (
              <button
                key={option.id}
                type="button"
                className="btn bq-packs2-type"
                aria-pressed={packType === option.id}
                disabled={purchaseBusy}
                onClick={() => {
                  setPackType(option.id);
                  setSelectedTier(4);
                }}
                style={{ "--pack-color": option.color } as CSSProperties}
              >
                <span className="bq-packs2-type-art" aria-hidden="true">
                  <PackFace pack={option} />
                </span>
                <strong>{option.label}</strong>
                <small>{option.name} · Test USDG</small>
              </button>
            ))}
          </div>
          {configId === 0n && (
            <p className="bq-demo-error" role="status">
              The pack catalog is awaiting its contract upgrade. New purchases are unavailable.
            </p>
          )}
          <div className="bq-packs2-selection" aria-label={`Selected pack ${pack.name}`}>
            <span className="bq-pack-stock-mix">
              {stocks.map(stock => (
                <StockLogo key={stock.address} symbol={stock.ticker} size={24} />
              ))}
            </span>
            <div>
              <strong>{pack.name}</strong>
              <small>{[...new Set(tiers?.map(tier => stockInfo(tier.token).ticker))].join(" · ")}</small>
            </div>
            <strong>{price === undefined ? "…" : `${formatToken(price, 6)} tUSDG`}</strong>
          </div>
          <h3 className="bq-packs2-eyebrow">Payout chances</h3>
          <div className="bq-packs2-probability" aria-hidden="true">
            {tiers?.map((tier, index) => (
              <span
                key={tier.end}
                style={{
                  width: `${(tier.end - (index ? tiers[index - 1].end : 0)) / 10}%`,
                  background: tierInfo(index).color,
                }}
              />
            ))}
          </div>
          <ul className="bq-packs2-legend">
            {tiers?.map((tier, index) => (
              <li key={tier.end} style={{ "--tier-color": tierInfo(index).color } as CSSProperties}>
                <span>{tierInfo(index).name}</span>
                <strong>{(tier.end - (index ? tiers[index - 1].end : 0)) / 10}%</strong>
              </li>
            ))}
          </ul>
          <div className="bq-packs2-average">
            <div>
              <span>Average payout</span>
              <small>At current Stock Token reference prices</small>
            </div>
            <strong>{average === undefined ? "—" : formatUsd(average)}</strong>
          </div>
          <p className="bq-demo-note">
            {currentReturn === undefined
              ? "Live return estimate unavailable."
              : `${currentReturn.toFixed(2)}% current estimated return before gas.`}{" "}
            {calibratedReturn
              ? `Calibrated to ${calibratedReturn}% using the recorded stock reference prices.`
              : "Calibration reference unavailable."}{" "}
            This is a long-run average, not a promised payout. Fixed token amounts change in reference value as prices
            move.
          </p>
          <div className="bq-packs2-quantity">
            <div className="join" aria-label="Quick pack quantities">
              {[1, 5, 10].map(value => (
                <button
                  type="button"
                  key={value}
                  className={`btn btn-sm join-item ${count === value ? "btn-secondary" : "btn-ghost"}`}
                  aria-pressed={count === value}
                  disabled={purchaseBusy}
                  onClick={() => setQuantity(String(value))}
                >
                  {value} {value === 1 ? "pack" : "packs"}
                </button>
              ))}
            </div>
            <label className="bq-packs2-input">
              Quantity
              <input
                className="input input-bordered"
                type="number"
                min="1"
                max="100"
                step="1"
                value={quantity}
                disabled={purchaseBusy}
                onChange={event => setQuantity(event.target.value)}
              />
            </label>
          </div>
          <div className="bq-packs2-total">
            <span>Total</span>
            <strong>{price === undefined || !validCount ? "—" : `${formatToken(cost, 6)} tUSDG`}</strong>
          </div>
          <div className="bq-packs2-open-action">
            {!address ? (
              <button className="btn btn-primary" onClick={openConnectModal}>
                Connect wallet to open
              </button>
            ) : !ready ? (
              <TxButton pending="Switching…" action={() => switchChainAsync({ chainId: network.id })}>
                Switch to {network.name}
              </TxButton>
            ) : pool === undefined ? (
              <button className="btn btn-primary" disabled>
                Checking payout table…
              </button>
            ) : allowance !== undefined && allowance < cost ? (
              <TxButton
                pending="Approving…"
                disabled={!validCount || price === undefined || paused}
                action={() => payment.writeContractAsync({ functionName: "approve", args: [deployed.address, cost] })}
              >
                Approve {formatToken(cost, 6)} tUSDG
              </TxButton>
            ) : (
              <TxButton
                pending="Opening…"
                disabled={
                  !validCount ||
                  !configId ||
                  price === undefined ||
                  allowance === undefined ||
                  balance === undefined ||
                  balance < cost ||
                  paused
                }
                action={() =>
                  core.writeContractAsync(
                    { functionName: "openPack", args: [packType, count, configId!] },
                    {
                      onBlockConfirmation: receipt => {
                        const [event] = parseEventLogs({
                          abi: packs2Contracts[foundry.id].BasqitPacks2.abi,
                          eventName: "OpenRequested",
                          logs: receipt.logs.filter(
                            log => log.address.toLowerCase() === deployed.address.toLowerCase(),
                          ),
                        });
                        if (event) {
                          setOffset(0);
                          setActiveOpening(event.args.id);
                        }
                      },
                    },
                  )
                }
              >
                {paused
                  ? "New openings paused"
                  : validCount && price !== undefined
                    ? `Open ${count} ${count === 1 ? "pack" : "packs"} · ${formatToken(cost, 6)} tUSDG`
                    : "Enter 1–100 packs"}
              </TxButton>
            )}
          </div>
          <p className="bq-demo-note">Some packs return less than their price. Network gas is additional.</p>
          {balance !== undefined && balance < cost && (
            <p className="bq-demo-note">Get more test USDG before opening.</p>
          )}
        </section>
      </div>
      <div className="bq-packs2-assurances">
        <span>Future drand randomness</span>
        <span>1,000 reusable slots</span>
        <span>Reveal, then collect</span>
      </div>
      <section className="bq-packs2-rewards" aria-label="Available payouts">
        <div className="bq-packs2-section-heading">
          <h2>What’s inside</h2>
          <span>
            {tiers?.length ?? "…"} payout levels · {illustrative ? "Illustrative examples" : "Select to preview"}
          </span>
        </div>
        {pool === undefined && (
          <p className="bq-demo-note" role="status">
            {poolError
              ? "The eligible payout table could not be loaded. Opening is unavailable until it is verified."
              : "Loading the complete eligible payout table…"}
            {poolError && (
              <button className="btn btn-ghost btn-sm" onClick={() => refetchPool()}>
                Retry
              </button>
            )}
          </p>
        )}
        <div className="bq-packs2-reward-grid">
          {cards.map(({ tier, index, chance }) => (
            <button
              type="button"
              key={tier.end}
              className="bq-packs2-reward"
              aria-pressed={selectedTier === index}
              onClick={() => setSelectedTier(index)}
              style={{ "--tier-color": tierInfo(index).color } as CSSProperties}
            >
              <span className="bq-packs2-reward-tier">
                {tierInfo(index).name}
                <strong>{chance}%</strong>
              </span>
              <div className="bq-packs2-reward-art">
                <StockLogo symbol={stockInfo(tier.token).ticker} size={48} />
                <span>
                  {illustrative ? "e.g. " : ""}
                  {stockInfo(tier.token).ticker}
                </span>
              </div>
              <strong>
                {tokenPrices[tier.token.toLowerCase()]
                  ? formatUsd((Number(tier.amount) / 1e18) * tokenPrices[tier.token.toLowerCase()]!)
                  : "Price unavailable"}
              </strong>
              <span>
                {formatUnits(tier.amount, 18)} t{stockInfo(tier.token).ticker}
              </span>
              <small>
                {illustrative ? "Example payout · Stock selected on reveal" : "Reference value · Test tokens only"}
              </small>
            </button>
          ))}
        </div>
        {illustrative && (
          <p className="bq-demo-note">
            Stocks shown are examples of each payout level. Reveal selects the level and stock separately: each of the{" "}
            {pool!.length} stocks has an equal chance at every level. Token amounts are fixed by the published table;
            market reference values can change.
          </p>
        )}
        <details className="bq-packs2-panel bq-packs2-table-details">
          <summary>View all number slots and payout details</summary>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Number slots</th>
                  <th>Payout</th>
                  <th>Level chance</th>
                </tr>
              </thead>
              <tbody>
                {pool !== undefined &&
                  tiers?.flatMap((tier, index) =>
                    (illustrative ? pool! : [{ token: tier.token, amounts: [tier.amount] }]).map(stock => (
                      <tr key={`${tier.end}-${stock.token}`}>
                        <td>{tierInfo(index).name}</td>
                        <td>
                          {index ? tiers[index - 1].end : 0}–{tier.end - 1}
                        </td>
                        <td>
                          {amountLabel(illustrative ? stock.amounts[index] : tier.amount, stock.token as EthAddress)}
                        </td>
                        <td>{(tier.end - (index ? tiers[index - 1].end : 0)) / 10}%</td>
                      </tr>
                    )),
                  )}
              </tbody>
            </table>
          </div>
          <p className="bq-demo-note">
            Every opening uses the complete table again. Outcomes can repeat. Dollar amounts are reference values; test
            tokens have no monetary value. The owner can upgrade payout rules, including rules for pending openings.
          </p>
        </details>
      </section>
      <section className="bq-packs2-panel bq-packs2-history">
        <h2>Your openings</h2>
        <p className="bq-demo-note">
          Reveal once the future round is published. Collect payouts individually or all at once per opening.
          Underfunded payouts keep their original result for later collection.
        </p>
        {!address ? (
          <p>Connect your wallet to see your openings.</p>
        ) : ownIds?.length === 0 ? (
          <p>No openings on this page yet.</p>
        ) : (
          ownIds?.map(id => (
            <OpeningCard
              key={`${address}-${id}`}
              id={id}
              ready={ready}
              label={amountLabel}
              vaults={vaults}
              onInspect={() => setActiveOpening(id)}
            />
          ))
        )}
        <div className="bq-packs2-network">
          <button
            className="btn btn-ghost btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 5))}
          >
            Newer
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!ownIds || ownIds.length < 5}
            onClick={() => setOffset(offset + 5)}
          >
            Older
          </button>
        </div>
      </section>
      <details className="bq-packs2-panel">
        <summary>Contract, vault &amp; test funding</summary>
        <div className="bq-packs2-network">
          <span className="badge badge-outline">
            {network.name}
            {network.id === 31337 && " · RH fork"}
          </span>
          <Address address={deployed.address} chain={network} />
        </div>
        <label className="bq-packs2-input">
          Stock to fund
          <select
            className="select select-bordered"
            value={fundingStock}
            disabled={stock.isMining || stockFaucet.isMining || core.isMining}
            onChange={event => setFundingStock(Number(event.target.value))}
          >
            {PACK_STOCKS.map(
              (asset, i) =>
                registered?.[asset.contract] && (
                  <option key={asset.ticker} value={i}>
                    {asset.company} · t{asset.ticker}
                  </option>
                ),
            )}
          </select>
        </label>
        <p>Available: {vault === undefined ? "—" : amountLabel(vault)}</p>
        <p>Revealed and unpaid: {liabilities === undefined ? "—" : amountLabel(liabilities)}</p>
        <p className="bq-demo-note">
          Unrevealed openings are additional liabilities whose amounts are not known yet. No maximum payout reserve is
          held. Funding can come from anyone.
        </p>
        <TxButton
          pending="Getting test stock…"
          disabled={!ready}
          action={() => stockFaucet.writeContractAsync({ functionName: "drip" })}
        >
          Get {faucetAmount === undefined ? "…" : formatToken(faucetAmount, 18)} test {fundingAsset.ticker}
        </TxButton>
        <p>Your stock: {stockBalance === undefined ? "—" : amountLabel(stockBalance)}</p>
        <label className="bq-packs2-input">
          Test {fundingAsset.ticker} to deposit
          <input
            className="input input-bordered"
            type="text"
            inputMode="decimal"
            value={funding}
            onChange={event => setFunding(event.target.value)}
          />
        </label>
        <p className="bq-demo-note">
          {fundAmount > 0n ? amountLabel(fundAmount) : "Enter a positive token amount."} Deposited prize tokens cannot
          be withdrawn.
        </p>
        {ready && stockAllowance !== undefined && stockAllowance < fundAmount ? (
          <TxButton
            pending="Approving stock…"
            disabled={fundAmount === 0n}
            action={() => stock.writeContractAsync({ functionName: "approve", args: [deployed.address, fundAmount] })}
          >
            Approve test stock
          </TxButton>
        ) : (
          <TxButton
            pending="Funding vault…"
            disabled={
              !ready ||
              fundAmount === 0n ||
              stockAllowance === undefined ||
              stockBalance === undefined ||
              stockBalance < fundAmount
            }
            action={() => core.writeContractAsync({ functionName: "fund", args: [fundingToken, fundAmount] })}
          >
            Fund vault
          </TxButton>
        )}
      </details>
      {activeOpening !== undefined && (
        <OpeningCard
          key={`theatre-${activeOpening}`}
          id={activeOpening}
          ready={ready}
          label={amountLabel}
          vaults={vaults}
          onClose={() => setActiveOpening(undefined)}
        />
      )}
      {previewOpen && (
        <PackReveal
          preview
          packPrice={price}
          quantity={Math.min(3, tiers?.length ?? 0)}
          results={cards.slice(0, 3).map(({ tier, index }) => ({
            token: tier.token,
            amount: tier.amount,
            slot: index ? (tiers?.[index - 1].end ?? 0) : 0,
            paid: false,
          }))}
          levels={revealLevels}
          stocks={stocks}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </section>
  );
}

function OpeningCard({
  id,
  ready,
  label,
  vaults,
  onInspect,
  onClose,
}: {
  id: bigint;
  ready: boolean;
  label: (amount: bigint, token: EthAddress) => string;
  vaults: Vaults;
  onInspect?: () => void;
  onClose?: () => void;
}) {
  const { data } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "opening",
    args: [id],
  });
  const o = data as Opening | undefined;
  const { data: termsData } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "openingTerms",
    args: [id],
    query: { enabled: !!data, refetchInterval: false },
  });
  const terms = termsData as PackConfig | undefined;
  const levels: RevealLevel[] =
    terms?.tiers.map((tier, index) => ({
      end: tier.end,
      token: tier.token,
      amount: tier.amount,
      ...levelInfo(index, terms.tiers.length),
    })) ?? [];
  const pack = packPresentation(terms?.price);

  const { data: payouts } = useScaffoldReadContract({
    ...readOptions,
    contractName: "BasqitPacks2",
    functionName: "outcomes",
    args: [id],
    query: { enabled: !!data?.revealed, refetchInterval: 5000 },
  });
  const results = terms ? confirmedPayouts(o, payouts as readonly Payout[] | undefined) : undefined;
  const core = useScaffoldWriteContract({ contractName: "BasqitPacks2", chainId: network.id });
  const { data: cachedRandomness } = useScaffoldReadContract({
    ...readOptions,
    contractName: "Packs2DrandBeacon",
    functionName: "randomness",
    args: [o?.round],
    query: { enabled: !!o && !o.revealed, refetchInterval: 5000 },
  });
  const cached = !!cachedRandomness && cachedRandomness !== `0x${"0".repeat(64)}`;
  const proof = useQuery({
    queryKey: ["packs2-drand", o?.round.toString()],
    enabled: !!o && !o.revealed && !cached,
    staleTime: Infinity,
    refetchInterval: query => (query.state.data ? false : 3000),
    retry: false,
    queryFn: () => fetchDrandProof(o!.round),
  });
  if (!o) return <p>Loading opening #{String(id)}…</p>;
  const controls = !o.revealed ? (
    <>
      <TxButton
        pending="Verifying signature…"
        disabled={!ready || (!proof.data && !cached)}
        action={() => core.writeContractAsync({ functionName: "reveal", args: [id, cached ? "0x" : proof.data!] })}
      >
        Reveal results
      </TxButton>
      {!cached && proof.error && (
        <p className="bq-demo-note" role="status">
          {proof.error.message} Checking again automatically.
        </p>
      )}
    </>
  ) : (
    <>
      <TxButton
        pending="Collecting all…"
        disabled={
          !ready ||
          core.isMining ||
          !results?.some(
            prize =>
              !prize.paid &&
              vaults[prize.token.toLowerCase()] !== undefined &&
              prize.amount <= vaults[prize.token.toLowerCase()]!,
          )
        }
        action={() => core.writeContractAsync({ functionName: "claimAll", args: [id] })}
      >
        {results?.every(prize => prize.paid) ? "All collected" : "Collect all"}
      </TxButton>
      <p className="bq-demo-note">
        One transaction for this opening. Already collected and underfunded payouts are skipped.
        {results &&
          Object.keys(vaults).some(token => {
            const required = results.reduce(
              (sum, prize) => sum + (!prize.paid && prize.token.toLowerCase() === token ? prize.amount : 0n),
              0n,
            );
            return vaults[token] !== undefined && required > vaults[token]!;
          }) &&
          " The vault needs more funding to cover every payout. Your unpaid results are retained."}
      </p>
      {!onClose && (
        <div className="bq-packs2-claims">
          {results?.map((prize, pack) => (
            <ClaimRow
              key={pack}
              pack={pack}
              ready={ready && !core.isMining}
              label={label}
              prize={prize}
              vault={vaults[prize.token.toLowerCase()]}
              claim={() => core.writeContractAsync({ functionName: "claim", args: [id, pack] })}
            />
          ))}
        </div>
      )}
      {!onClose && (
        <details>
          <summary>Verify the seed</summary>
          <code className="bq-packs2-seed">{o.seed}</code>
        </details>
      )}
    </>
  );
  if (onClose)
    return (
      <PackReveal
        id={id}
        quantity={o.quantity}
        packPrice={terms?.price}
        results={results}
        levels={levels}
        stocks={stocks}
        onClose={onClose}
        controls={controls}
        waiting={
          o.revealed
            ? "Loading your confirmed result…"
            : proof.data || cached
              ? "Your future round is ready. Confirm the reveal to open your pack."
              : `Waiting for drand round ${o.round}. You can come back later.`
        }
      />
    );
  return (
    <article className="bq-packs2-opening">
      <h3>
        Opening #{String(id)} · {pack.name}
        {terms ? ` · ${formatToken(terms.price, 6)} tUSDG each` : ""} · {o.quantity}{" "}
        {o.quantity === 1 ? "pack" : "packs"}
      </h3>
      <p className="bq-demo-note">
        Drand round {String(o.round)} ·{" "}
        {o.revealed ? "Result fixed" : proof.data || cached ? "Ready to reveal" : "Waiting for the future round"}
      </p>
      <button className="btn btn-secondary btn-sm bq-pack-resume" onClick={onInspect}>
        {o.revealed ? "View opening ↗" : "Continue opening ↗"}
      </button>
      {controls}
    </article>
  );
}

function ClaimRow({
  pack,
  ready,
  label,
  prize,
  vault,
  claim,
}: {
  pack: number;
  ready: boolean;
  label: (amount: bigint, token: EthAddress) => string;
  prize: Payout;
  vault?: bigint;
  claim: () => Promise<unknown>;
}) {
  const { slot, paid } = prize;
  const short = vault !== undefined && vault < prize.amount;
  return (
    <div className="bq-packs2-claim">
      <StockLogo symbol={stockInfo(prize.token).ticker} size={28} />
      <div>
        <strong>
          Pack {pack + 1} · {label(prize.amount, prize.token)}
        </strong>
        <p className="bq-demo-note">
          Number {slot} ·{" "}
          {paid ? "Paid" : short ? "Awaiting vault funding · original payout retained" : "Ready to collect"}
        </p>
      </div>
      {!paid && (
        <TxButton pending="Collecting…" disabled={!ready || vault === undefined || short} action={claim}>
          {short ? "Awaiting funding" : "Collect"}
        </TxButton>
      )}
      {paid && <span className="bq-demo-ok">Collected</span>}
    </div>
  );
}
