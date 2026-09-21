import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * @example
 * const externalContracts = {
 *   1: {
 *     DAI: {
 *       address: "0x...",
 *       abi: [...],
 *     },
 *   },
 * } as const;
 */
const externalContracts = {} as const;

export default externalContracts satisfies GenericContractsDeclaration;

// The issuer catalog supplies chain-4663 addresses at runtime. Keep the read ABI here;
// no unverified static address list is generated from ticker symbols.
export const stockTokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const stockTokenContract = (address: `0x${string}`) => ({ address, abi: stockTokenAbi });

// Dynamic issuer tokens and USDG share the standard ERC-20 trade interface.
export { erc20Abi as tradeTokenAbi } from "viem";
