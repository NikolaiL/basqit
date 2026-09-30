import { createPublicClient, http } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

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

const BASKET_ABI = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "components",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "token", type: "address" },
          { name: "unitsPerShare", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteMint",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteRedeem",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256[]" }],
    stateMutability: "view",
  },
] as const;
type Deployed = { address: Address; abi: readonly unknown[]; deployedOnBlock?: number };

/** Testnet contracts from `deployedContracts.ts`, written by `yarn deploy --network robinhoodTestnet`. */
const testnet = (deployedContracts as unknown as Record<number, Record<string, Deployed> | undefined>)[46630];
const pick = (name: string) => testnet?.[name];

export type PacksDeployment = {
  deployBlock: number;
  faucet: Address;
  factory: Address;
  gifts: Address;
  packs: Address;
  giftRouter: Address;
  swapAdapter: Address;
  purchaseRouter: Address;
  sellRouter: Address;
  abis: {
    faucet: readonly unknown[];
    factory: readonly unknown[];
    gifts: readonly unknown[];
    packs: readonly unknown[];
    giftRouter: readonly unknown[];
    swapAdapter: readonly unknown[];
    purchaseRouter: readonly unknown[];
    sellRouter: readonly unknown[];
    token: readonly unknown[];
    basket: readonly unknown[];
  };
};

const NAMES = {
  faucet: "BasqitTestnetFaucet",
  factory: "BasqitFactory",
  gifts: "BasqitGifts",
  packs: "BasqitPacks",
  giftRouter: "BasqitGiftRouter",
  swapAdapter: "TestnetSwapAdapter",
  purchaseRouter: "BasqitPurchaseRouter",
  sellRouter: "BasqitSellRouter",
} as const;

/** `null` until the testnet is deployed. */
export const packsTestnet: PacksDeployment | null = Object.values(NAMES).every(pick)
  ? {
      deployBlock: Math.min(...Object.values(NAMES).map(name => pick(name)!.deployedOnBlock ?? 0)),
      ...(Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, pick(name)!.address])) as Record<
        keyof typeof NAMES,
        Address
      >),
      abis: {
        ...(Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, pick(name)!.abi])) as Record<
          keyof typeof NAMES,
          readonly unknown[]
        >),
        token: pick("TestnetToken")?.abi ?? [],
        // A basket share is an ERC-20 created by the factory; its ABI is only needed for the calls below.
        basket: BASKET_ABI,
      },
    }
  : null;

/** tUSDG and the listed test stocks, read on chain: several are the same contract, so they have no names above. */
let assets: Promise<{ usdg: Address; stocks: Address[] }> | undefined;
export const testnetAssets = () =>
  (assets ??= Promise.all([
    packsClient.readContract({
      address: packsTestnet!.faucet,
      abi: [{ type: "function", name: "token", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
      functionName: "token",
    }),
    packsClient.readContract({
      address: packsTestnet!.factory,
      abi: [
        {
          type: "function",
          name: "stockTokens",
          inputs: [],
          outputs: [{ type: "address[]" }],
          stateMutability: "view",
        },
      ],
      functionName: "stockTokens",
    }),
  ]).then(([usdg, stocks]) => ({ usdg: usdg as Address, stocks: [...stocks] as Address[] })));

export const explorerTx = (hash: string) => `${robinhoodTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) => `${robinhoodTestnet.blockExplorers.default.url}/address/${address}`;
