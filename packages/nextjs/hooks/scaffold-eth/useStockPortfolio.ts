import { useQuery } from "@tanstack/react-query";
import type { ActionsResponse, Portfolio } from "~~/services/portfolio/types";

async function load<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load data. Please try again.");
  return data;
}

export function useStockPortfolio(address?: string) {
  return useQuery({
    queryKey: ["stock-portfolio", 4663, address],
    queryFn: ({ signal }) => load<Portfolio>(`/api/stocks/portfolio?address=${address}`, signal),
    enabled: !!address,
    staleTime: 60000,
    retry: false,
  });
}

export function useStockActions() {
  return useQuery({
    queryKey: ["stock-actions", 4663],
    queryFn: ({ signal }) => load<ActionsResponse>("/api/stocks/actions", signal),
    staleTime: 60000,
    retry: false,
  });
}
