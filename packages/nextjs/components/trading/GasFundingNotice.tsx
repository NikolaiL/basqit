"use client";

import { FundingPanel } from "./FundingPanel";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useTradeBalance } from "~~/hooks/scaffold-eth/useStockTrade";
import { NATIVE } from "~~/services/funding/shared";

export function GasFundingNotice({
  showAction = true,
  disabled = false,
}: {
  showAction?: boolean;
  disabled?: boolean;
}) {
  const { address } = useAccount();
  const gas = useTradeBalance(NATIVE, address && isAddress(address) ? (address as `0x${string}`) : undefined);
  if (gas.data?.balance !== 0n) return null;
  return (
    <div className="bq-gas-notice" role="status">
      <p>
        You need ETH on Robinhood Chain for stock purchases. Start with around $1–2; choose your amount. Network fees
        vary.
      </p>
      {showAction && <FundingPanel destination="ETH" triggerLabel="Get ETH" disabled={disabled} />}
    </div>
  );
}
