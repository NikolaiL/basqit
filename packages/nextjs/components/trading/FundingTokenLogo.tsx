"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { type FundingToken, NATIVE, networkIds } from "~~/services/funding/shared";

export function FundingTokenLogo({ token }: { token: FundingToken }) {
  const native = token.address.toLowerCase() === NATIVE;
  const network = Object.keys(networkIds).find(name => networkIds[name] === token.chainId);
  const { data } = useQuery<{ logo: string | null }>({
    queryKey: ["funding-token-logo", token.chainId, token.address.toLowerCase()],
    enabled: !token.logo && !native && !!network,
    staleTime: query => (query.state.data?.logo ? 30 * 86400000 : 5 * 60000),
    gcTime: 86400000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/funding/token-logo?${new URLSearchParams({ network: network!, address: token.address })}`,
        { signal },
      );
      if (!response.ok) throw new Error("Logo unavailable");
      return response.json();
    },
  });
  const source = token.logo ?? data?.logo ?? (native ? "/token-logos/eth.svg" : undefined);
  const [failed, setFailed] = useState<string>();
  return (
    <span className="bq-funding-token-logo" aria-hidden="true">
      {source && failed !== source ? (
        <Image
          src={source}
          alt=""
          width={32}
          height={32}
          unoptimized
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(source)}
        />
      ) : (
        token.symbol.slice(0, 2)
      )}
    </span>
  );
}
