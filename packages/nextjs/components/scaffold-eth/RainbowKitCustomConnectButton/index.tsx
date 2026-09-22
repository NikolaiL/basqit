"use client";

// @refresh reset
import { AddressInfoDropdown } from "./AddressInfoDropdown";
import { AddressQRCodeModal } from "./AddressQRCodeModal";
import { RevealBurnerPKModal } from "./RevealBurnerPKModal";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { getBlockExplorerAddressLink } from "@scaffold-ui/hooks";
import { Address } from "viem";
import { useMiniapp } from "~~/components/MiniappProvider";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Custom Wagmi Connect Button (watch balance + custom design)
 */
export const RainbowKitCustomConnectButton = () => {
  const { isMiniApp, connectWallet, walletError } = useMiniapp();
  const { targetNetwork } = useTargetNetwork();

  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal, mounted, authenticationStatus }) => {
        const connected = mounted && account;
        const blockExplorerAddressLink = account
          ? getBlockExplorerAddressLink(targetNetwork, account.address)
          : undefined;

        return (
          <>
            {(() => {
              if (!connected || authenticationStatus === "unauthenticated" || authenticationStatus === "loading") {
                return (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={isMiniApp && !connected ? () => void connectWallet() : openConnectModal}
                    title={walletError || undefined}
                    type="button"
                    disabled={!mounted || authenticationStatus === "loading"}
                  >
                    {connected
                      ? authenticationStatus === "loading"
                        ? "Confirm in wallet…"
                        : "Sign in"
                      : "Connect Wallet"}
                  </button>
                );
              }

              return (
                <>
                  <AddressInfoDropdown
                    address={account.address as Address}
                    displayName={account.displayName}
                    ensAvatar={account.ensAvatar}
                    blockExplorerAddressLink={blockExplorerAddressLink}
                  />
                  <AddressQRCodeModal address={account.address as Address} modalId="qrcode-modal" />
                  <RevealBurnerPKModal />
                </>
              );
            })()}
          </>
        );
      }}
    </ConnectButton.Custom>
  );
};
