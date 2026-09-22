import { useConnectModal } from "@rainbow-me/rainbowkit";

export function useWalletConnectModal() {
  const modal = useConnectModal();
  return {
    ...modal,
    // RainbowKit hides its dialog while loading/authenticated, but auto-SIWE can leave the open flag set.
    connectModalOpen: modal.connectModalOpen && !!modal.openConnectModal,
  };
}
