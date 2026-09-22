"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RainbowKitAuthenticationProvider, createAuthenticationAdapter } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useConfig, useSignMessage } from "wagmi";
import { getAccount } from "wagmi/actions";
import { notification } from "~~/utils/scaffold-eth";

type Session = { address: string | null; expires?: number };
async function sessionRequest(method: string, body?: unknown): Promise<Session & { nonce: string }> {
  const response = await fetch("/api/auth/session", {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Please sign in with your wallet to continue.");
  return response.json();
}
export function useWalletSession() {
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["wallet-session", address?.toLowerCase()],
    queryFn: () => sessionRequest("GET"),
    staleTime: 30000,
    refetchInterval: 60000,
    retry: false,
  });
  return {
    ...query,
    authenticated: !query.isError && !!address && query.data?.address === address.toLowerCase(),
  };
}
export function WalletAuthentication({ children }: { children: React.ReactNode }) {
  const { address, chainId, status: connectionStatus } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [attemptedAddress, setAttemptedAddress] = useState<string>();
  const [signing, setSigning] = useState(false);
  const signingLock = useRef(false);
  const config = useConfig();
  const queryClient = useQueryClient();
  const session = useWalletSession();
  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => (await sessionRequest("POST", { action: "nonce" })).nonce,
        createMessage: ({ nonce, address, chainId }) =>
          createSiweMessage({
            domain: window.location.host,
            address,
            chainId,
            nonce,
            uri: window.location.origin,
            version: "1",
            statement:
              "Sign in to Basqit to view stock portfolios and load your wallet balances. This does not authorize transactions.",
          }),
        verify: async ({ message, signature }) => {
          try {
            const result = await sessionRequest("POST", { action: "verify", message, signature });
            queryClient.setQueryData(["wallet-session", result.address], result);
            return true;
          } catch {
            return false;
          }
        },
        signOut: async () => {
          await sessionRequest("DELETE");
          queryClient.removeQueries({ queryKey: ["funding-balances-v2"] });
          queryClient.removeQueries({ queryKey: ["stock-portfolio"] });
          await queryClient.invalidateQueries({ queryKey: ["wallet-session"] });
        },
      }),
    [queryClient],
  );
  const shouldSign =
    connectionStatus === "connected" &&
    !!address &&
    !!chainId &&
    session.isSuccess &&
    !session.authenticated &&
    attemptedAddress !== address;

  useEffect(() => {
    if (connectionStatus === "disconnected" || session.authenticated) setAttemptedAddress(undefined);
    if (!shouldSign || signingLock.current || !address || !chainId) return;
    signingLock.current = true;
    setAttemptedAddress(address);
    setSigning(true);
    const unchanged = () => {
      const current = getAccount(config);
      return current.status === "connected" && current.address === address && current.chainId === chainId;
    };
    void (async () => {
      try {
        const nonce = await adapter.getNonce();
        if (!unchanged()) return;
        const message = await adapter.createMessage({ nonce, address, chainId });
        if (!unchanged()) return;
        const signature = await signMessageAsync({ account: address, message });
        if (!unchanged()) return;
        if (!(await adapter.verify({ message, signature }))) throw new Error("Sign-in verification failed");
      } catch {
        if (unchanged()) notification.error("Sign-in was not completed. Select Sign in to try again.");
      } finally {
        signingLock.current = false;
        setSigning(false);
      }
    })();
  }, [
    connectionStatus,
    session.authenticated,
    shouldSign,
    address,
    chainId,
    adapter,
    signMessageAsync,
    signing,
    config,
  ]);

  return (
    <RainbowKitAuthenticationProvider
      adapter={adapter}
      status={
        session.isPending || signing || shouldSign
          ? "loading"
          : session.authenticated
            ? "authenticated"
            : "unauthenticated"
      }
    >
      {children}
    </RainbowKitAuthenticationProvider>
  );
}
