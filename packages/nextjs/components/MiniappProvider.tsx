"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { useAccount, useConfig, useConnect } from "wagmi";
import { getAccount } from "wagmi/actions";
import { detectMiniapp } from "~~/services/miniapp-runtime";

export { sdk };
type MiniappContext = Awaited<typeof sdk.context>;
type Cast = { text: string; embeds?: string[] };

export async function openLink(url: string, isMiniApp = false) {
  if (isMiniApp) return sdk.actions.openUrl(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function composeCast({ text, embeds = [] }: Cast, isMiniApp = false) {
  const links = embeds.slice(0, 2) as [] | [string] | [string, string];
  if (isMiniApp) return sdk.actions.composeCast({ text, embeds: links });
  const url = new URL("https://farcaster.xyz/~/compose");
  url.searchParams.set("text", text);
  links.forEach(link => url.searchParams.append("embeds[]", link));
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openProfile(fid: number, isMiniApp = false) {
  if (isMiniApp) return sdk.actions.viewProfile({ fid });
  window.open(`https://farcaster.xyz/~/profiles/${fid}`, "_blank", "noopener,noreferrer");
}

const MiniappContext = createContext<{
  context: MiniappContext | null;
  isReady: boolean;
  isMiniApp: boolean;
  walletAddress?: string;
  walletError: string | null;
  connectWallet: () => Promise<void>;
  openLink: (url: string) => Promise<void>;
  composeCast: (cast: Cast) => ReturnType<typeof composeCast>;
  openProfile: (fid: number) => Promise<void>;
  promptAddMiniApp: () => Promise<boolean>;
} | null>(null);

export function useMiniapp() {
  const value = useContext(MiniappContext);
  if (!value) throw new Error("useMiniapp must be used within MiniappProvider");
  return value;
}

// Adapted from the extension: SDK context, splash, safe areas, wallet and host actions.
export function MiniappProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<MiniappContext | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const { address, status } = useAccount();
  const { connectAsync } = useConnect();
  const config = useConfig();
  const attempted = useRef(false);
  const connecting = useRef(false);
  const addPromptDone = useRef(false);
  const isMiniApp = context !== null;

  useEffect(() => {
    let cancelled = false;
    const callReady = () => void sdk.actions.ready().catch(() => {});
    callReady();
    const retry = setTimeout(callReady, 500);
    // Detection and ready run independently; a web SDK promise may never settle.
    void detectMiniapp(sdk).then(value => {
      if (cancelled) return;
      setContext(value);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  useEffect(() => {
    if (!context) return;
    const style = document.documentElement.style;
    const sides = ["top", "right", "bottom", "left"] as const;
    for (const side of sides) {
      const inset = context.client.safeAreaInsets?.[side];
      const pixels = typeof inset === "number" && Number.isFinite(inset) ? Math.max(0, Math.min(200, inset)) : 0;
      style.setProperty(`--safe-area-inset-${side}`, `max(env(safe-area-inset-${side}, 0px), ${pixels}px)`);
    }
    return () => sides.forEach(side => style.removeProperty(`--safe-area-inset-${side}`));
  }, [context]);

  const connectWallet = useCallback(async () => {
    if (!isMiniApp || connecting.current || getAccount(config).status !== "disconnected") return;
    connecting.current = true;
    setWalletError(null);
    try {
      // Register only in a confirmed Farcaster host: its reconnect must not stall web wallets.
      const { farcasterMiniApp } = await import("@farcaster/miniapp-wagmi-connector");
      const provider = await sdk.wallet.getEthereumProvider();
      if (!provider) throw new Error("No Farcaster wallet is available.");
      const chainId = Number(await provider.request({ method: "eth_chainId" }));
      if (getAccount(config).status !== "disconnected") return;
      const connector = config.connectors.find(item => item.id === "farcaster") ?? farcasterMiniApp();
      // Keep the wallet's current network. Trade flows request their own network switches.
      await connectAsync({ connector, chainId });
    } catch {
      setWalletError("Could not connect your Farcaster wallet. Please try again.");
    } finally {
      connecting.current = false;
    }
  }, [isMiniApp, config, connectAsync]);
  useEffect(() => {
    if (!isMiniApp || attempted.current || status === "connecting" || status === "reconnecting") return;
    attempted.current = true;
    if (status === "disconnected") void connectWallet();
  }, [isMiniApp, status, connectWallet]);

  async function promptAddMiniApp() {
    if (!isMiniApp || context.client.added || addPromptDone.current) return false;
    addPromptDone.current = true;
    try {
      await sdk.actions.addMiniApp();
      setContext(current => current && { ...current, client: { ...current.client, added: true } });
      return true;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "RejectedByUser") addPromptDone.current = false;
      return false;
    }
  }

  return (
    <MiniappContext.Provider
      value={{
        context,
        isReady,
        isMiniApp,
        walletAddress: address,
        walletError,
        connectWallet,
        openLink: url => openLink(url, isMiniApp),
        composeCast: cast => composeCast(cast, isMiniApp),
        openProfile: fid => openProfile(fid, isMiniApp),
        promptAddMiniApp,
      }}
    >
      {children}
    </MiniappContext.Provider>
  );
}
