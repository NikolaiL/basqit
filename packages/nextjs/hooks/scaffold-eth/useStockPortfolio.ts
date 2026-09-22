import { useQuery } from "@tanstack/react-query";
import { useWalletSession } from "~~/components/WalletAuthentication";
import type { ActionsResponse, Portfolio } from "~~/services/portfolio/types";

async function load<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load data. Please try again.");
  return data;
}

export function useStockPortfolio(address?: string) {
  const session = useWalletSession();
  const query = useQuery({
    queryKey: ["stock-portfolio", 4663, address, session.data?.address],
    queryFn: ({ signal }) => {
      if (!session.authenticated) throw new Error("Sign in to view stock portfolios.");
      return load<Portfolio>(`/api/stocks/portfolio?address=${address}`, signal);
    },
    enabled: session.authenticated && !!address,
    staleTime: 60000,
    retry: false,
  });
  return { ...query, data: session.authenticated ? query.data : undefined };
}

export function useStockActions() {
  return useQuery({
    queryKey: ["stock-actions", 4663],
    queryFn: ({ signal }) => load<ActionsResponse>("/api/stocks/actions", signal),
    staleTime: 60000,
    retry: false,
  });
}
