// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/*
 .------------------------------------------------------------------------------------------------------.
 | ```````````````````````````````````````````````````````````````````````````````````````````````````` |
 | `````````````````````````:####````````````````````````````````````````````````:####`:``````````````` |
 | `####################````:####````````````````````````````````````````````````:####`:``+##:````````` |
 | `###::::::::::::::+##````:####`:+#+:``````++###+:`````:++##++:`````++#+:`:+++``++++``:+###+++``````` |
 | `+##`````````+#+``##+````:###########```+#########``:#########+```######+####`:####``########``````` |
 | `:##:`````##:###``##:````:#####:+####+`:####:`+###+`+###+``####``+####::#####`:####``:####+::``````` |
 | ``##+`:+::##:###`+##`````:####```#####``++++:+#####`:#######+:```####+``:####`:####```####:````````` |
 | ``###`:++:##:###`###`````:####```+####``+##########```:+######+``####+``:####`:####```####:````````` |
 | ``+##``:``:+`:+:`##+`````:####:``####+`+###+``+####`+###:`:####+`#####``#####`:####```####+````+++:` |
 | ``:##+::::::::::+##:`````:###+#######``############`:####++####:`:###########`:####```+######`#####` |
 | ```:##############+``````:###::####+````+####+`####``:+######+:```:####+:####``####````+#####`:###+` |
 | ````````````````````````````````````````````````````````````````````````:####``````````````````````` |
 | ````````````````````````````````````````````````````````````````````````:####``````````````````````` |
 | ```Build a basket. Send a gift. Open a pack.```````````````````````````````````````````````````````` |
 '------------------------------------------------------------------------------------------------------'
*/

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IBasqitRebalanceRouter } from "./interfaces/IBasqitRebalanceRouter.sol";
import { IPriceReference } from "./interfaces/IPriceReference.sol";

/// @dev The parts of BasqitFactory a basket reads; an interface avoids a circular import.
interface IBasqitFactorySettings {
    function usdG() external view returns (address);
    function isAllowedToken(address token) external view returns (bool);
    function priceReference() external view returns (IPriceReference);
    function rebalanceRouter() external view returns (address);
}

/// @notice ERC-20 basket share backed in kind by allowed tokens (Stock Tokens, USDG, WETH).
/// One share (1e18) is redeemable for a set amount of each component while the basket is fully
/// backed; if an issuer ever removes tokens from the basket, every holder shares the shortfall pro rata, and
/// minting stops until the basket is whole again so a new minter never fills an old shortfall.
/// Amounts owed by `redeemAvailable` rank first: they were already redeemed, so a later shortfall falls on the
/// shares still outstanding.
/// No owner and no fees. A basket created without a manager never changes. A managed basket's manager may change
/// what a share holds through a rebalance, under rules fixed at creation: each change is announced `noticePeriod`
/// ahead, executes within EXECUTION_WINDOW after that, at most once per MIN_REBALANCE_INTERVAL, may lose at most
/// `maxSlippageBps` of the traded value at the factory's reference prices, and at most twice that within LOSS_WINDOW.
contract BasqitToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Component {
        address token;
        // raw token amount backing one share
        uint256 unitsPerShare;
    }

    uint256 public constant SHARE_UNIT = 1e18;
    uint256 public constant MAX_COMPONENTS = 10;
    /// @notice An announced rebalance must execute within this window after its notice ends, or it lapses.
    uint256 public constant EXECUTION_WINDOW = 1 days;
    /// @notice Rebalances are at least this far apart, so the slippage bound cannot be repeated quickly.
    uint256 public constant MIN_REBALANCE_INTERVAL = 4 hours;
    /// @notice Rebalance losses add up within this window and may total at most twice `maxSlippageBps`, so the
    /// per-rebalance allowance cannot be taken again and again.
    uint256 public constant LOSS_WINDOW = 7 days;

    /// @notice A component being reduced, and what one share holds of it afterwards (0 removes it).
    struct Sell {
        address token;
        uint256 unitsPerShare;
    }

    /// @notice A token receiving `bps` of the sale proceeds (all buys sum to 10_000).
    struct Buy {
        address token;
        uint16 bps;
    }

    address public immutable factory;
    /// @notice Zero for a basket that never changes.
    address public immutable manager;
    /// @notice Seconds between announcing a rebalance and executing it.
    uint32 public immutable noticePeriod;
    uint16 public immutable maxSlippageBps;

    Component[] private _components;

    Sell[] private _pendingSells;
    Buy[] private _pendingBuys;
    /// @notice When the pending rebalance may execute (0 = none pending).
    uint64 public rebalanceReadyAt;
    uint64 public lastRebalanceAt;
    uint64 public lossWindowStart;
    /// @notice Losses in this window, in bps of the value each rebalance traded.
    uint32 public lossBpsInWindow;

    /// @notice Components a holder redeemed but could not receive yet (e.g. the token was paused).
    mapping(address holder => mapping(address token => uint256)) public owed;
    /// @notice Sum of `owed` per token: held here but no longer backing shares.
    mapping(address token => uint256) public totalOwed;

    event Minted(address indexed sender, address indexed to, uint256 shares);
    event Redeemed(address indexed sender, address indexed to, uint256 shares);
    event ComponentOwed(address indexed holder, address indexed token, uint256 amount);
    event OwedClaimed(address indexed holder, address indexed token, address indexed to, uint256 amount);
    event RebalanceScheduled(Sell[] sells, Buy[] buys, uint64 readyAt, uint64 expiresAt);
    event RebalanceCancelled();
    event Rebalanced(Component[] before, Component[] after_, uint256 valueSold, uint256 valueReceived);

    error EmptyComponents();
    error TooManyComponents(uint256 count);
    error ZeroAddress();
    error ZeroUnits(address token);
    error DuplicateToken(address token);
    error ZeroShares();
    error InvalidRecipient(address to);
    error ShortDelivery(address token, uint256 received, uint256 expected);
    error NothingOwed(address token);
    error UnderBacked();
    error NotManager();
    error NotManaged();
    error RebalancePending();
    error NoRebalancePending();
    error NoticeRequired();
    error RebalanceNotReady(uint64 readyAt);
    error RebalanceExpired(uint64 expiredAt);
    error RebalanceTooSoon(uint64 nextAt);
    error EmptyPlan();
    error NotComponent(address token);
    error NotReduced(address token);
    error InvalidSplit();
    error TokenNotAllowed(address token);
    error NoShares();
    error NotConfigured();
    error LegCountMismatch();
    error UnexpectedBalance(address token, uint256 actual, uint256 expected);
    error NoReferencePrice(address token);
    error ValueLost(uint256 valueSold, uint256 valueReceived);
    error LossBudgetExceeded(uint256 usedBps, uint256 budgetBps);
    error DeadlineExpired(uint256 deadline);

    modifier onlyManager() {
        if (manager == address(0)) revert NotManaged();
        if (msg.sender != manager) revert NotManager();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        Component[] memory components_,
        address manager_,
        uint32 noticePeriod_,
        uint16 maxSlippageBps_
    ) ERC20(name_, symbol_) {
        uint256 count = components_.length;
        if (count == 0) revert EmptyComponents();
        if (count > MAX_COMPONENTS) revert TooManyComponents(count);
        for (uint256 i = 0; i < count; i++) {
            Component memory c = components_[i];
            if (c.token == address(0)) revert ZeroAddress();
            if (c.unitsPerShare == 0) revert ZeroUnits(c.token);
            for (uint256 j = 0; j < i; j++) {
                if (components_[j].token == c.token) revert DuplicateToken(c.token);
            }
            _components.push(c);
        }
        factory = msg.sender;
        manager = manager_;
        noticePeriod = noticePeriod_;
        maxSlippageBps = maxSlippageBps_;
    }

    /// @notice Deposit every component and mint shares; amounts round up so minters never underpay.
    function mint(uint256 shares, address to) external nonReentrant {
        if (shares == 0) revert ZeroShares();
        _checkRecipient(to);
        // An under-backed basket would pay a new minter less than they deposit and hand the rest to old holders.
        if (!isFullyBacked()) revert UnderBacked();
        uint256 count = _components.length;
        for (uint256 i = 0; i < count; i++) {
            Component memory c = _components[i];
            uint256 amount = Math.mulDiv(c.unitsPerShare, shares, SHARE_UNIT, Math.Rounding.Ceil);
            // Stock Tokens are issuer-upgradeable; never assume a transfer delivers what it says.
            uint256 before = IERC20(c.token).balanceOf(address(this));
            IERC20(c.token).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(c.token).balanceOf(address(this)) - before;
            if (received != amount) revert ShortDelivery(c.token, received, amount);
        }
        _mint(to, shares);
        emit Minted(msg.sender, to, shares);
    }

    /// @notice Burn shares and withdraw every component. All or nothing: reverts if any component
    /// cannot be transferred. Use `redeemAvailable` when a component is paused or frozen.
    function redeem(uint256 shares, address to) external nonReentrant {
        uint256[] memory amounts = _burnForRedeem(shares, to);
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] != 0) IERC20(_components[i].token).safeTransfer(to, amounts[i]);
        }
        emit Redeemed(msg.sender, to, shares);
    }

    /// @notice Emergency exit: burn shares, receive every component that can move now, and record
    /// the rest as owed to the caller, claimable with `claimOwed` once the token can move again.
    function redeemAvailable(uint256 shares, address to) external nonReentrant {
        uint256[] memory amounts = _burnForRedeem(shares, to);
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) continue;
            address token = _components[i].token;
            if (!IERC20(token).trySafeTransfer(to, amounts[i])) {
                owed[msg.sender][token] += amounts[i];
                totalOwed[token] += amounts[i];
                emit ComponentOwed(msg.sender, token, amounts[i]);
            }
        }
        emit Redeemed(msg.sender, to, shares);
    }

    function claimOwed(address token, address to) external nonReentrant returns (uint256 amount) {
        _checkRecipient(to);
        amount = owed[msg.sender][token];
        if (amount == 0) revert NothingOwed(token);
        owed[msg.sender][token] = 0;
        totalOwed[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit OwedClaimed(msg.sender, token, to, amount);
    }

    function quoteMint(uint256 shares) external view returns (uint256[] memory amounts) {
        uint256 count = _components.length;
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = Math.mulDiv(_components[i].unitsPerShare, shares, SHARE_UNIT, Math.Rounding.Ceil);
        }
    }

    /// @notice Exact amounts `redeem` would pay right now for `shares`.
    function quoteRedeem(uint256 shares) public view returns (uint256[] memory amounts) {
        uint256 count = _components.length;
        uint256 supply = totalSupply();
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = _redeemAmount(_components[i], shares, supply);
        }
    }

    /// @notice False once any component holds less than its full backing (e.g. after an issuer burn).
    function isFullyBacked() public view returns (bool) {
        uint256 supply = totalSupply();
        for (uint256 i = 0; i < _components.length; i++) {
            Component memory c = _components[i];
            // Unpaid redemptions come first: at zero supply the share check below is trivially met,
            // so without this a new deposit would cover old holders' deficit.
            if (IERC20(c.token).balanceOf(address(this)) < totalOwed[c.token]) return false;
            if (_available(c.token) < Math.mulDiv(c.unitsPerShare, supply, SHARE_UNIT, Math.Rounding.Ceil)) {
                return false;
            }
        }
        return true;
    }

    // --- Rebalancing (managed baskets) ------------------------------------------------------

    /// @notice Announce a change; it may execute from `rebalanceReadyAt` for EXECUTION_WINDOW. One at a time; a
    /// lapsed plan is replaced.
    function scheduleRebalance(Sell[] calldata sells, Buy[] calldata buys) external onlyManager {
        _clearLapsedPlan();
        _checkPlan(sells, buys);
        for (uint256 i = 0; i < sells.length; i++) {
            _pendingSells.push(sells[i]);
        }
        for (uint256 i = 0; i < buys.length; i++) {
            _pendingBuys.push(buys[i]);
        }
        uint64 readyAt = uint64(block.timestamp + noticePeriod);
        rebalanceReadyAt = readyAt;
        emit RebalanceScheduled(sells, buys, readyAt, uint64(readyAt + EXECUTION_WINDOW));
    }

    function cancelRebalance() external onlyManager {
        if (rebalanceReadyAt == 0) revert NoRebalancePending();
        _clearPlan();
        emit RebalanceCancelled();
    }

    /// @notice Execute the announced change. `sellLegs` and `buyLegs` follow the plan's order.
    function executeRebalance(
        IBasqitRebalanceRouter.Leg[] calldata sellLegs,
        IBasqitRebalanceRouter.Leg[] calldata buyLegs,
        uint256 deadline
    ) external onlyManager nonReentrant {
        uint64 readyAt = rebalanceReadyAt;
        if (readyAt == 0) revert NoRebalancePending();
        if (block.timestamp < readyAt) revert RebalanceNotReady(readyAt);
        if (block.timestamp > readyAt + EXECUTION_WINDOW) revert RebalanceExpired(uint64(readyAt + EXECUTION_WINDOW));
        Sell[] memory sells = _pendingSells;
        Buy[] memory buys = _pendingBuys;
        _clearPlan();
        _rebalance(sells, buys, sellLegs, buyLegs, deadline);
    }

    /// @notice Announce and execute in one transaction; only for baskets created with no notice.
    function rebalanceNow(
        Sell[] calldata sells,
        Buy[] calldata buys,
        IBasqitRebalanceRouter.Leg[] calldata sellLegs,
        IBasqitRebalanceRouter.Leg[] calldata buyLegs,
        uint256 deadline
    ) external onlyManager nonReentrant {
        if (noticePeriod != 0) revert NoticeRequired();
        _clearLapsedPlan();
        _checkPlan(sells, buys);
        _rebalance(sells, buys, sellLegs, buyLegs, deadline);
    }

    function pendingRebalance() external view returns (Sell[] memory sells, Buy[] memory buys, uint64 readyAt) {
        return (_pendingSells, _pendingBuys, rebalanceReadyAt);
    }

    function componentCount() external view returns (uint256) {
        return _components.length;
    }

    function componentAt(uint256 index) external view returns (Component memory) {
        return _components[index];
    }

    function components() external view returns (Component[] memory) {
        return _components;
    }

    /// @dev Shape and size only; allowance, supply and prices are checked at execution, when they matter.
    function _checkPlan(Sell[] memory sells, Buy[] memory buys) private view {
        if (sells.length == 0 || buys.length == 0) revert EmptyPlan();
        if (buys.length > MAX_COMPONENTS) revert TooManyComponents(buys.length);
        uint256 count = _components.length;
        for (uint256 i = 0; i < sells.length; i++) {
            (bool found, uint256 index) = _indexOf(sells[i].token);
            if (!found) revert NotComponent(sells[i].token);
            if (sells[i].unitsPerShare >= _components[index].unitsPerShare) revert NotReduced(sells[i].token);
            if (sells[i].unitsPerShare == 0) count--;
            for (uint256 j = 0; j < i; j++) {
                if (sells[j].token == sells[i].token) revert DuplicateToken(sells[i].token);
            }
        }
        uint256 total;
        for (uint256 i = 0; i < buys.length; i++) {
            if (buys[i].token == address(0)) revert ZeroAddress();
            if (buys[i].bps == 0) revert InvalidSplit();
            total += buys[i].bps;
            (bool found,) = _indexOf(buys[i].token);
            if (!found) count++;
            for (uint256 j = 0; j < sells.length; j++) {
                if (sells[j].token == buys[i].token) revert DuplicateToken(buys[i].token);
            }
            for (uint256 j = 0; j < i; j++) {
                if (buys[j].token == buys[i].token) revert DuplicateToken(buys[i].token);
            }
        }
        if (total != 10_000) revert InvalidSplit();
        if (count > MAX_COMPONENTS) revert TooManyComponents(count);
    }

    /// @dev A live plan blocks a new one; a lapsed one is dropped.
    function _clearLapsedPlan() private {
        uint64 readyAt = rebalanceReadyAt;
        if (readyAt == 0) return;
        if (block.timestamp <= readyAt + EXECUTION_WINDOW) revert RebalancePending();
        _clearPlan();
        emit RebalanceCancelled();
    }

    function _clearPlan() private {
        delete _pendingSells;
        delete _pendingBuys;
        rebalanceReadyAt = 0;
    }

    /// @dev Everything one rebalance moves, gathered so the steps below stay small.
    struct Trade {
        address[] sellTokens;
        uint256[] sellAmounts;
        uint256[] sellBalances;
        address[] buyTokens;
        uint16[] buyBps;
        uint256[] buyOldUnits;
        uint256[] buyNewUnits;
    }

    function _rebalance(
        Sell[] memory sells,
        Buy[] memory buys,
        IBasqitRebalanceRouter.Leg[] calldata sellLegs,
        IBasqitRebalanceRouter.Leg[] calldata buyLegs,
        uint256 deadline
    ) private {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (sellLegs.length != sells.length || buyLegs.length != buys.length) revert LegCountMismatch();
        uint64 last = lastRebalanceAt;
        if (last != 0 && block.timestamp < last + MIN_REBALANCE_INTERVAL) {
            revert RebalanceTooSoon(uint64(last + MIN_REBALANCE_INTERVAL));
        }
        uint256 supply = totalSupply();
        if (supply == 0) revert NoShares();
        IBasqitFactorySettings settings = IBasqitFactorySettings(factory);
        address router = settings.rebalanceRouter();
        if (router == address(0) || address(settings.priceReference()) == address(0)) revert NotConfigured();
        for (uint256 i = 0; i < buys.length; i++) {
            if (!settings.isAllowedToken(buys[i].token)) revert TokenNotAllowed(buys[i].token);
        }

        Component[] memory before = _components;
        Trade memory trade = _prepare(sells, buys, supply);
        _swap(router, trade, sellLegs, buyLegs);

        (uint256 valueSold, uint256 valueReceived) = _measure(settings, trade, supply);
        if (valueSold == 0 || valueReceived * 10_000 < valueSold * (10_000 - maxSlippageBps)) {
            revert ValueLost(valueSold, valueReceived);
        }
        _spendLossBudget(valueSold, valueReceived);
        _applyPlan(sells, trade);
        lastRebalanceAt = uint64(block.timestamp);
        emit Rebalanced(before, _components, valueSold, valueReceived);
    }

    /// @dev Approves exactly the sold amounts to the router for the length of the call.
    function _swap(
        address router,
        Trade memory trade,
        IBasqitRebalanceRouter.Leg[] calldata sellLegs,
        IBasqitRebalanceRouter.Leg[] calldata buyLegs
    ) private {
        for (uint256 i = 0; i < trade.sellTokens.length; i++) {
            IERC20(trade.sellTokens[i]).forceApprove(router, trade.sellAmounts[i]);
        }
        IBasqitRebalanceRouter(router)
            .rebalance(trade.sellTokens, trade.sellAmounts, trade.buyTokens, trade.buyBps, sellLegs, buyLegs);
        for (uint256 i = 0; i < trade.sellTokens.length; i++) {
            IERC20(trade.sellTokens[i]).forceApprove(router, 0);
        }
    }

    /// @dev What leaves the basket: (old − new) units per share for every share, rounded down, but never more than
    /// the balance above the new backing, so a token short of backing can still be sold out. A token sold to zero
    /// takes everything available with it, surplus included, so nothing is stranded once it is no longer a component.
    function _prepare(Sell[] memory sells, Buy[] memory buys, uint256 supply)
        private
        view
        returns (Trade memory trade)
    {
        trade.sellTokens = new address[](sells.length);
        trade.sellAmounts = new uint256[](sells.length);
        trade.sellBalances = new uint256[](sells.length);
        for (uint256 i = 0; i < sells.length; i++) {
            (bool found, uint256 index) = _indexOf(sells[i].token);
            // Components change only through a rebalance, which clears the pending plan; checked anyway.
            if (!found) revert NotComponent(sells[i].token);
            uint256 current = _components[index].unitsPerShare;
            uint256 target = sells[i].unitsPerShare;
            if (target >= current) revert NotReduced(sells[i].token);
            uint256 available = _available(sells[i].token);
            uint256 keep = Math.mulDiv(target, supply, SHARE_UNIT, Math.Rounding.Ceil);
            uint256 spare = available > keep ? available - keep : 0;
            trade.sellTokens[i] = sells[i].token;
            trade.sellAmounts[i] =
                target == 0 ? available : Math.min(Math.mulDiv(current - target, supply, SHARE_UNIT), spare);
            trade.sellBalances[i] = IERC20(sells[i].token).balanceOf(address(this));
        }
        trade.buyTokens = new address[](buys.length);
        trade.buyBps = new uint16[](buys.length);
        trade.buyOldUnits = new uint256[](buys.length);
        trade.buyNewUnits = new uint256[](buys.length);
        for (uint256 i = 0; i < buys.length; i++) {
            trade.buyTokens[i] = buys[i].token;
            trade.buyBps[i] = buys[i].bps;
            (bool found, uint256 index) = _indexOf(buys[i].token);
            if (found) trade.buyOldUnits[i] = _components[index].unitsPerShare;
        }
    }

    /// @dev Exactly the sold amounts left, valued rounded up. What came back counts only as far as it raises what
    /// holders can redeem: bought units are the available balance per share, rounded down, so tokens that fill past
    /// redeemers' unpaid claims or round away are charged to the rebalance, not to holders.
    function _measure(IBasqitFactorySettings settings, Trade memory trade, uint256 supply)
        private
        view
        returns (uint256 valueSold, uint256 valueReceived)
    {
        IPriceReference prices = settings.priceReference();
        address usdG = settings.usdG();
        for (uint256 i = 0; i < trade.sellTokens.length; i++) {
            address token = trade.sellTokens[i];
            uint256 expected = trade.sellBalances[i] - trade.sellAmounts[i];
            uint256 actual = IERC20(token).balanceOf(address(this));
            if (actual != expected) revert UnexpectedBalance(token, actual, expected);
            valueSold += _value(prices, usdG, token, trade.sellAmounts[i], Math.Rounding.Ceil);
        }
        for (uint256 i = 0; i < trade.buyTokens.length; i++) {
            address token = trade.buyTokens[i];
            uint256 units = Math.mulDiv(_available(token), SHARE_UNIT, supply);
            if (units <= trade.buyOldUnits[i]) revert ZeroUnits(token);
            trade.buyNewUnits[i] = units;
            uint256 gained =
                Math.mulDiv(units, supply, SHARE_UNIT) - Math.mulDiv(trade.buyOldUnits[i], supply, SHARE_UNIT);
            valueReceived += _value(prices, usdG, token, gained, Math.Rounding.Floor);
        }
    }

    /// @dev Adds this rebalance's loss, in bps of the value it traded, to the rolling LOSS_WINDOW total.
    function _spendLossBudget(uint256 valueSold, uint256 valueReceived) private {
        if (block.timestamp >= lossWindowStart + LOSS_WINDOW) {
            lossWindowStart = uint64(block.timestamp);
            lossBpsInWindow = 0;
        }
        if (valueReceived >= valueSold) return;
        uint256 used = lossBpsInWindow + Math.mulDiv(valueSold - valueReceived, 10_000, valueSold, Math.Rounding.Ceil);
        uint256 budget = 2 * uint256(maxSlippageBps);
        if (used > budget) revert LossBudgetExceeded(used, budget);
        lossBpsInWindow = uint32(used);
    }

    /// @dev Sold tokens take their new amount (removed at 0); bought tokens take the units measured above.
    function _applyPlan(Sell[] memory sells, Trade memory trade) private {
        for (uint256 i = 0; i < sells.length; i++) {
            (, uint256 index) = _indexOf(sells[i].token);
            _components[index].unitsPerShare = sells[i].unitsPerShare;
        }
        for (uint256 i = 0; i < trade.buyTokens.length; i++) {
            (bool found, uint256 index) = _indexOf(trade.buyTokens[i]);
            if (found) _components[index].unitsPerShare = trade.buyNewUnits[i];
            else _components.push(Component(trade.buyTokens[i], trade.buyNewUnits[i]));
        }
        for (uint256 i = _components.length; i > 0; i--) {
            if (_components[i - 1].unitsPerShare == 0) {
                _components[i - 1] = _components[_components.length - 1];
                _components.pop();
            }
        }
        if (_components.length > MAX_COMPONENTS) revert TooManyComponents(_components.length);
    }

    /// @dev USDG value at reference prices; USDG itself is worth its face value.
    function _value(IPriceReference prices, address usdG, address token, uint256 amount, Math.Rounding rounding)
        private
        view
        returns (uint256)
    {
        if (amount == 0) return 0;
        if (token == usdG) return amount;
        uint256 price = prices.priceUsdG(token);
        if (price == 0) revert NoReferencePrice(token);
        return Math.mulDiv(amount, price, 10 ** IERC20Metadata(token).decimals(), rounding);
    }

    function _indexOf(address token) private view returns (bool found, uint256 index) {
        for (uint256 i = 0; i < _components.length; i++) {
            if (_components[i].token == token) return (true, i);
        }
    }

    function _burnForRedeem(uint256 shares, address to) private returns (uint256[] memory amounts) {
        if (shares == 0) revert ZeroShares();
        _checkRecipient(to);
        amounts = quoteRedeem(shares);
        _burn(msg.sender, shares);
    }

    /// @dev Fixed amount per share, rounded down, but never more than a pro-rata slice of what the
    /// basket actually holds. Fully backed baskets pay the fixed amount; a shortfall is shared.
    function _redeemAmount(Component memory c, uint256 shares, uint256 supply) private view returns (uint256) {
        uint256 fixedAmount = Math.mulDiv(c.unitsPerShare, shares, SHARE_UNIT);
        if (supply == 0) return fixedAmount;
        return Math.min(fixedAmount, Math.mulDiv(_available(c.token), shares, supply));
    }

    /// @dev Balance that still backs shares; owed amounts belong to past redeemers.
    function _available(address token) private view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = totalOwed[token];
        return balance > reserved ? balance - reserved : 0;
    }

    function _checkRecipient(address to) private view {
        if (to == address(0)) revert ZeroAddress();
        if (to == address(this)) revert InvalidRecipient(to);
    }
}
