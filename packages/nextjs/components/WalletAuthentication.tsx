"use client";

import { useMemo } from "react";
import { RainbowKitAuthenticationProvider, createAuthenticationAdapter } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { useAccount } from "wagmi";

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
  const { address } = useAccount();
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
            queryClient.setQueryData(["wallet-session", address?.toLowerCase()], result);
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
    [address, queryClient],
  );
  return (
    <RainbowKitAuthenticationProvider
      adapter={adapter}
      status={session.isPending ? "loading" : session.authenticated ? "authenticated" : "unauthenticated"}
    >
      {children}
    </RainbowKitAuthenticationProvider>
  );
}
