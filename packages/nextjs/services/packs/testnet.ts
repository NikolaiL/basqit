import { createPublicClient, http } from "viem";
import deployment from "~~/contracts/packsTestnet.json";

/** Robinhood Chain testnet. Multicall3 verified at the canonical address (3,808 bytes of code, 28 Sept 2026). */
export const robinhoodTestnet = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
} as const;

export const TESTNET_ETH_FAUCET = "https://faucet.testnet.chain.robinhood.com";
export const DICE_SITE = "https://diceprotocol.world";
export const DICE_DOCS = "https://diceprotocol.world/docs/";

export const packsClient = createPublicClient({ chain: robinhoodTestnet, transport: http() });

type Address = `0x${string}`;
export type PacksDeployment = {
  chainId: number;
  deployBlock: number;
  usdg: Address;
  faucet: Address;
  gifts: Address;
  packs: Address;
  giftRouter: Address;
  swapAdapter: Address;
  dice: Address;
  stocks: Address[];
  abis: {
    gifts: readonly unknown[];
    packs: readonly unknown[];
    giftRouter: readonly unknown[];
    swapAdapter: readonly unknown[];
    faucet: readonly unknown[];
    token: readonly unknown[];
  };
};

/** Written by `scripts/export-packs.mjs` after a testnet deploy; `null` until then. */
export const packsTestnet = (deployment as { deployment: PacksDeployment | null }).deployment;

export const explorerTx = (hash: string) => `${robinhoodTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) => `${robinhoodTestnet.blockExplorers.default.url}/address/${address}`;
