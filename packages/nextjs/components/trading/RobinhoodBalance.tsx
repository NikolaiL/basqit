"use client";

import { formatUnits, isAddress } from "viem";
import { TokenAmount } from "~~/components/TokenAmount";
import { useTradeBalance } from "~~/hooks/scaffold-eth/useStockTrade";
import { type FundingDestination, fundingDestinations } from "~~/services/funding/shared";

export function RobinhoodBalance({ address, asset = "USDG" }: { address: string; asset?: FundingDestination }) {
  const balance = useTradeBalance(
    fundingDestinations[asset].address,
    isAddress(address) ? (address as `0x${string}`) : undefined,
  );
  return (
    <span className="bq-usdg-balance" title={`${asset} balance on Robinhood Chain`}>
      {balance.data ? (
        <TokenAmount value={formatUnits(balance.data.balance, balance.data.decimals)} />
      ) : balance.isError ? (
        "Unavailable"
      ) : (
        "Loading…"
      )}{" "}
      {asset}
    </span>
  );
}
