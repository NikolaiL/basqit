import { parseAbi } from "viem";

/** The parts of BasqitToken the app reads and writes. Baskets are created by the factory, so they are not in
 * deployedContracts; this mirrors packages/foundry/contracts/BasqitToken.sol. */
export const basketAbi = parseAbi([
  "struct Component { address token; uint256 unitsPerShare; }",
  "struct Sell { address token; uint256 unitsPerShare; }",
  "struct Buy { address token; uint16 bps; }",
  "struct Leg { address adapter; uint256 minAmountOut; bytes routeData; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function components() view returns (Component[])",
  "function quoteMint(uint256) view returns (uint256[])",
  "function quoteRedeem(uint256) view returns (uint256[])",
  "function manager() view returns (address)",
  "function noticePeriod() view returns (uint32)",
  "function maxSlippageBps() view returns (uint16)",
  "function rebalanceReadyAt() view returns (uint64)",
  "function lastRebalanceAt() view returns (uint64)",
  "function lossWindowStart() view returns (uint64)",
  "function lossBpsInWindow() view returns (uint32)",
  "function EXECUTION_WINDOW() view returns (uint256)",
  "function MIN_REBALANCE_INTERVAL() view returns (uint256)",
  "function LOSS_WINDOW() view returns (uint256)",
  "function pendingRebalance() view returns (Sell[] sells, Buy[] buys, uint64 readyAt)",
  "function scheduleRebalance(Sell[] sells, Buy[] buys)",
  "function cancelRebalance()",
  "function executeRebalance(Leg[] sellLegs, Leg[] buyLegs, uint256 deadline)",
  "function rebalanceNow(Sell[] sells, Buy[] buys, Leg[] sellLegs, Leg[] buyLegs, uint256 deadline)",
  "error ValueLost(uint256 valueSold, uint256 valueReceived)",
  "error LossBudgetExceeded(uint256 usedBps, uint256 budgetBps)",
  "error RebalanceTooSoon(uint64 nextAt)",
  "error TokenNotAllowed(address token)",
  "error RebalanceNotReady(uint64 readyAt)",
  "error RebalanceExpired(uint64 expiredAt)",
  "error NoShares()",
  "error RebalancePending()",
  "error DeadlineExpired(uint256 deadline)",
]);

export const basketEvents = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Minted(address indexed sender, address indexed to, uint256 shares)",
  "event Redeemed(address indexed sender, address indexed to, uint256 shares)",
  "event RebalanceScheduled((address token, uint256 unitsPerShare)[] sells, (address token, uint16 bps)[] buys, uint64 readyAt, uint64 expiresAt)",
  "event RebalanceCancelled()",
  "event Rebalanced((address token, uint256 unitsPerShare)[] before, (address token, uint256 unitsPerShare)[] after_, uint256 valueSold, uint256 valueReceived)",
]);

export const factoryEvents = parseAbi([
  "event BasketCreated(address indexed basket, address indexed creator, string name, string symbol, uint16 feeBps, (address token, uint256 unitsPerShare)[] components, (bool managed, uint8 noticeHours, uint16 maxSlippageBps) management)",
]);

export const routerEvents = parseAbi([
  "event BasketPurchased(address indexed buyer, address indexed recipient, address indexed basket, uint256 shares, uint256 usdGSpent, uint256 creatorFee, uint256 usdGRefunded)",
  "event BasketSold(address indexed seller, address indexed recipient, address indexed basket, uint256 shares, uint256 usdGReceived, uint256 creatorFee)",
]);

export const adapterEvents = parseAbi(["event PriceSet(address indexed token, uint256 price)"]);

/** The testnet swap adapter's price, which is also the managed baskets' price reference on testnet. */
export const priceAbi = parseAbi(["function priceUsdG(address token) view returns (uint256)"]);
