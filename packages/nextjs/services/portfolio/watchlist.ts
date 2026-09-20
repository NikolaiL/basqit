import { getAddress, isAddress } from "viem";

export type SavedWallet = { address: `0x${string}`; name: string };
export const WATCHLIST_KEY = "basqit:wallets:v1";

export function parseWallets(raw: string | null): SavedWallet[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Invalid saved wallets");
  const seen = new Set<string>();
  return data.flatMap(row => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.address !== "string" ||
      !isAddress(row.address) ||
      typeof row.name !== "string"
    )
      return [];
    const address = getAddress(row.address) as `0x${string}`;
    if (seen.has(address)) return [];
    seen.add(address);
    return [{ address, name: row.name.trim().slice(0, 40) }];
  });
}

export function saveWallet(wallets: SavedWallet[], address: string, name: string): SavedWallet[] {
  const wallet = { address: getAddress(address.trim()) as `0x${string}`, name: name.trim().slice(0, 40) };
  const existing = wallets.findIndex(item => item.address.toLowerCase() === wallet.address.toLowerCase());
  return existing < 0 ? [...wallets, wallet] : wallets.map((item, index) => (index === existing ? wallet : item));
}
