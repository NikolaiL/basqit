import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useMiniapp } from "~~/components/MiniappProvider";

export function useWalletConnectModal() {
  const modal = useConnectModal();
  const { isConnected } = useAccount();
  const { isMiniApp, connectWallet } = useMiniapp();
  if (isMiniApp && !isConnected) {
    return { openConnectModal: () => void connectWallet(), connectModalOpen: false };
  }
  return {
    ...modal,
    // RainbowKit hides its dialog while loading/authenticated, but auto-SIWE can leave the open flag set.
    connectModalOpen: modal.connectModalOpen && !!modal.openConnectModal,
  };
}
