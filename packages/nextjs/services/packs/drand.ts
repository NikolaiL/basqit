import type { Hex } from "viem";

export async function fetchDrandProof(round: bigint): Promise<Hex | null> {
  const response = await fetch(`https://api.drand.sh/v2/beacons/evmnet/rounds/${round}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  // The live relay returns 425 for a future round; missing rounds can also return 404.
  if (response.status === 425 || response.status === 404) return null;
  if (!response.ok) throw new Error("The drand relay is temporarily unavailable.");
  const result = await response.json();
  if (
    String(result.round) !== String(round) ||
    typeof result.signature !== "string" ||
    !/^[a-fA-F0-9]{128}$/.test(result.signature)
  )
    throw new Error("Invalid drand response.");
  return `0x${result.signature}`;
}
