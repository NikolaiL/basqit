// Verifies that a 0x cross-chain funding transaction executes the quoted transfer, not just that its metadata looks
// right. Only the verified route is accepted: AllowanceHolder -> 0x bridge settler -> Across V4 SpokePool.
// Evidence and sources: basqit-docs/docs/FUNDING-ROUTE-VERIFICATION.md (verified 1 October 2026).
import { type Address, decodeAbiParameters, decodeFunctionData, parseAbi, parseAbiParameters } from "viem";

export const ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";
/** 0x Settler registry on every chain: `ownerOf(5)` is the current bridge settler, `prev(5)` the previous one. */
export const SETTLER_REGISTRY = "0x00000000000004533fe15556b1e086bb1a72ceae";
export const BRIDGE_SETTLER_TOKEN_ID = 5n;
const ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ROBINHOOD = 4663n;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ROBINHOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
/** Across V4 SpokePool and its `wrappedNativeToken()` per source chain (docs.across.to and RPC reads). */
export const ACROSS: Record<number, { spoke: string; weth: string }> = {
  1: { spoke: "0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5", weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  10: { spoke: "0x6f26bf09b1c792e3228e5467807a900a503c0281", weth: "0x4200000000000000000000000000000000000006" },
  8453: { spoke: "0x09aea4b2242abc8bb4bb78d537a67a245a7bec64", weth: "0x4200000000000000000000000000000000000006" },
  42161: { spoke: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a", weth: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" },
};
// ponytail: the 0x fee observed on every verified quote (0.15%). Anything above is rejected; a 0x price change means
// funding quotes fail until this is reviewed.
const MAX_PROVIDER_FEE_PPM = 1_500n;
const BASIS = 1_000_000n;

const holder = parseAbi(["function exec(address operator, address token, uint256 amount, address target, bytes data)"]);
const bridgeSettler = parseAbi(["function execute(bytes[] actions, bytes32 zid)"]);
const actions = parseAbi([
  "function TRANSFER_FROM(address recipient, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes sig)",
  "function SETTLER_SWAP(address token, uint256 amount, address settler, bytes settlerData)",
  "function UNDERPAYMENT_CHECK(uint256 msgValueMin)",
  "function BASIC(address bridgeToken, uint256 ppm, address pool, uint256 offset, bytes data)",
  "function BRIDGE_ERC20_TO_ACROSS(address spoke, bytes depositData)",
  "function BRIDGE_NATIVE_TO_ACROSS(address spoke, bytes depositData)",
]);
const swapSettler = parseAbi([
  "function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32 zid)",
]);
const deposit = parseAbiParameters(
  "bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message",
);

export type FundingIntent = {
  chainId: number;
  /** Sell token as requested; the native placeholder for ETH. */
  token: string;
  sellAmount: bigint;
  wallet: string;
  destination: "USDG" | "ETH";
  minBuyAmount: bigint;
  basqitFee: { bps: number; recipient: string | null };
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const word = (address: string) => `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
function fail(reason: string): never {
  throw new Error(`Funding execution does not match the quote: ${reason}.`);
}

/**
 * Decodes the transaction and checks every action against the requested transfer. Returns the bridge settler, which
 * the caller must still confirm against the registry on the source chain (`isRegisteredBridgeSettler`).
 */
export function verifyAcrossFunding(intent: FundingIntent, tx: { to: string; data: `0x${string}`; value: string }) {
  const route = ACROSS[intent.chainId];
  if (!route) fail("unsupported source network");
  const native = same(intent.token, ETH);
  if (!same(tx.to, ALLOWANCE_HOLDER)) fail("unexpected target");
  if (BigInt(tx.value) !== (native ? intent.sellAmount : 0n)) fail("native value differs from the input");

  let outer;
  try {
    outer = decodeFunctionData({ abi: holder, data: tx.data });
  } catch {
    fail("unexpected entry call");
  }
  const [operator, token, amount, settler, inner] = outer.args;
  if (!same(operator, settler)) fail("operator is not the settler");
  if (!same(token, native ? ETH : intent.token) || amount !== intent.sellAmount) fail("input token or amount");

  let list: readonly `0x${string}`[];
  try {
    list = decodeFunctionData({ abi: bridgeSettler, data: inner }).args[0];
  } catch {
    fail("unexpected settler call");
  }
  if (!list.length) fail("no actions");

  // Replays the balance the settler will hold, so the guaranteed output can be recomputed from the calldata.
  let balance = intent.sellAmount;
  let heldToken = native ? ETH : intent.token.toLowerCase();
  let swapped = false;
  let basqitFeeSeen = false;
  let providerPpm = 0n;
  let guaranteed: bigint | undefined;
  for (const [index, encoded] of list.entries()) {
    if (guaranteed !== undefined) fail("action after the bridge");
    let action;
    try {
      action = decodeFunctionData({ abi: actions, data: encoded });
    } catch {
      fail("unsupported action");
    }
    switch (action.functionName) {
      case "TRANSFER_FROM": {
        const [recipient, permit] = action.args;
        if (index !== 0 || native || !same(recipient, settler)) fail("unexpected transfer");
        if (!same(permit.permitted.token, intent.token) || permit.permitted.amount !== intent.sellAmount)
          fail("transfer token or amount");
        break;
      }
      case "UNDERPAYMENT_CHECK":
        break;
      case "BASIC": {
        // Only fee payments: a plain native send, or `transfer(recipient, amount)` on the sell token.
        const [feeToken, ppm, pool, offset, data] = action.args;
        if (swapped || !same(feeToken, heldToken) || ppm > BASIS) fail("unexpected payment");
        let recipient: string;
        if (native) {
          if (offset !== 0n || data !== "0x") fail("unexpected native payment");
          recipient = pool;
        } else {
          if (!same(pool, feeToken) || offset !== 36n || data.length !== 138 || !data.startsWith("0xa9059cbb"))
            fail("unexpected token payment");
          recipient = `0x${data.slice(34, 74)}`;
        }
        const fee = intent.basqitFee;
        if (fee.recipient && fee.bps > 0 && !basqitFeeSeen && same(recipient, fee.recipient)) {
          if (ppm !== BigInt(fee.bps) * 100n) fail("Basqit fee rate");
          basqitFeeSeen = true;
        } else if ((providerPpm += ppm) > MAX_PROVIDER_FEE_PPM) fail("provider fee above the verified rate");
        balance -= (balance * ppm) / BASIS;
        break;
      }
      case "SETTLER_SWAP": {
        // The bridge settler only calls a Settler registered in the same registry (`_requireValidSettler`).
        const [swapToken, swapAmount, , settlerData] = action.args;
        if (swapped || !same(swapToken, heldToken) || swapAmount > balance) fail("unexpected swap");
        let slippage;
        try {
          slippage = decodeFunctionData({ abi: swapSettler, data: settlerData }).args[0];
        } catch {
          fail("unexpected swap call");
        }
        if (!same(slippage.recipient, settler) || slippage.minAmountOut === 0n) fail("swap recipient or minimum");
        heldToken = slippage.buyToken.toLowerCase();
        balance = slippage.minAmountOut;
        swapped = true;
        break;
      }
      case "BRIDGE_ERC20_TO_ACROSS":
      case "BRIDGE_NATIVE_TO_ACROSS": {
        const [spoke, depositData] = action.args;
        if (!same(spoke, route.spoke)) fail("not the verified Across SpokePool");
        const nativeBridge = action.functionName === "BRIDGE_NATIVE_TO_ACROSS";
        if (nativeBridge !== (heldToken === ETH)) fail("bridge kind");
        let d;
        try {
          d = decodeAbiParameters(deposit, depositData);
        } catch {
          fail("unexpected deposit");
        }
        const [depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, chain, , , , , message] = d;
        // Across refunds an unfilled deposit to the depositor, so both must be the wallet.
        if (!same(depositor, word(intent.wallet)) || !same(recipient, word(intent.wallet))) fail("recipient");
        if (chain !== ROBINHOOD || message !== "0x") fail("destination");
        if (!same(outputToken, word(intent.destination === "USDG" ? USDG : ROBINHOOD_WETH))) fail("output token");
        if (!same(inputToken, word(nativeBridge ? route.weth : heldToken))) fail("bridged token");
        if (inputAmount === 0n) fail("deposit amount");
        // The settler deposits its balance and scales the output by the same ratio (0x-settler src/core/Across.sol).
        guaranteed = (outputAmount * balance) / inputAmount;
        break;
      }
    }
  }
  if (guaranteed === undefined) fail("no bridge");
  if (intent.basqitFee.recipient && intent.basqitFee.bps > 0 && !basqitFeeSeen) fail("Basqit fee missing");
  if (guaranteed < intent.minBuyAmount) fail("guaranteed output below the displayed minimum");
  return { settler: settler.toLowerCase() as Address, guaranteed };
}

const registry = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function prev(uint128 tokenId) view returns (address)",
]);

/** The registry's current or previous bridge settler on the source chain (0x documents a dwell period for `prev`). */
export async function isRegisteredBridgeSettler(
  client: { readContract: (args: any) => Promise<unknown> },
  settler: string,
) {
  const [current, previous] = await Promise.all([
    client.readContract({
      address: SETTLER_REGISTRY,
      abi: registry,
      functionName: "ownerOf",
      args: [BRIDGE_SETTLER_TOKEN_ID],
    }),
    client.readContract({
      address: SETTLER_REGISTRY,
      abi: registry,
      functionName: "prev",
      args: [BRIDGE_SETTLER_TOKEN_ID],
    }),
  ]);
  return [current, previous].some(address => typeof address === "string" && same(address, settler));
}
