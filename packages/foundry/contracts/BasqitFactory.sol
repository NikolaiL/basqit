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

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { BasqitToken } from "./BasqitToken.sol";
import { IPriceReference } from "./interfaces/IPriceReference.sol";

/// @notice Creates Basqit baskets from an owner-curated list of allowed tokens (Stock Tokens, USDG, WETH) and
/// records each basket's creator and creator fee. Holds the settings managed baskets share: the price reference for
/// their rebalance guard and the rebalance router.
contract BasqitFactory is Ownable2Step {
    /// @notice Creator fees are capped at 1% of the USDG spent or received.
    uint16 public constant MAX_CREATOR_FEE_BPS = 100;
    /// @notice Fee changes take effect only after this delay, so buyers can see them coming.
    uint256 public constant FEE_CHANGE_DELAY = 1 days;
    /// @notice A newly allowed token is usable only after this delay, so a managed basket cannot be moved into a
    /// token listed the same minute.
    uint256 public constant LISTING_DELAY = 1 days;
    /// @notice Longest notice a managed basket may give before a rebalance, in hours.
    uint8 public constant MAX_NOTICE_HOURS = 72;
    /// @notice A new price reference or rebalance router applies only after this delay: longer than any notice plus
    /// execution window (72 h + 24 h), so a plan never executes under settings holders could not see when it was
    /// announced.
    uint256 public constant SETTINGS_CHANGE_DELAY = 4 days;
    /// @notice Most value a rebalance may lose against reference prices; creators may promise less.
    uint16 public constant MAX_SLIPPAGE_BPS = 200;
    /// @notice Least a managed basket may allow: venues charge fees and every step rounds down, so less than this
    /// would make the basket impossible to rebalance.
    uint16 public constant MIN_SLIPPAGE_BPS = 10;

    struct CreatorFee {
        uint16 bps;
        uint16 pendingBps;
        uint64 pendingAt;
    }

    /// @notice Fixed at creation. `managed` false: the basket never changes. True: the creator may rebalance it,
    /// announcing each change `noticeHours` ahead and losing at most `maxSlippageBps` of value at reference prices.
    struct Management {
        bool managed;
        uint8 noticeHours;
        uint16 maxSlippageBps;
    }

    address public immutable usdG;

    /// @notice When each token becomes allowed (0 = not allowed).
    mapping(address token => uint64) public allowedAt;
    // Keeps `_allowedTokens` free of duplicates when a disallowed token is allowed again.
    mapping(address token => bool) private _seen;
    address[] private _allowedTokens;

    mapping(address basket => bool) public isBasket;
    mapping(address basket => address) public creatorOf;
    mapping(address basket => CreatorFee) private _fees;
    address[] private _baskets;

    /// @notice When creator fees switch on (0 = off). Switching on waits FEE_CHANGE_DELAY like any
    /// other fee change; switching off is immediate.
    uint64 public feesEnabledAt;

    IPriceReference private _reference;
    IPriceReference public pendingReference;
    uint64 public pendingReferenceAt;
    address private _router;
    address public pendingRouter;
    uint64 public pendingRouterAt;

    event TokenAllowed(address indexed token, uint64 effectiveAt);
    event TokenDisallowed(address indexed token);
    event BasketCreated(address indexed basket, address indexed creator, string name, string symbol, uint16 feeBps);
    event BasketManagement(address indexed basket, address indexed manager, uint8 noticeHours, uint16 maxSlippageBps);
    event CreatorFeeScheduled(address indexed basket, uint16 bps, uint64 effectiveAt);
    event FeesEnabledScheduled(bool enabled, uint64 effectiveAt);
    event PriceReferenceScheduled(address indexed source, uint64 effectiveAt);
    event RebalanceRouterScheduled(address indexed router, uint64 effectiveAt);

    error ZeroAddress();
    error UnlistedToken(address token);
    error FeeTooHigh(uint16 bps);
    error NotCreator(address basket);
    error UnknownBasket(address basket);
    error RenounceDisabled();
    error NoticeTooLong(uint8 hoursGiven);
    error SlippageOutOfRange(uint16 bps);
    error UnmanagedSettings();
    error NotAContract(address account);

    /// @param allowed allowed immediately, so a fresh deployment works without waiting.
    constructor(address initialOwner, address usdG_, address[] memory allowed, address reference_)
        Ownable(initialOwner)
    {
        if (usdG_ == address(0)) revert ZeroAddress();
        usdG = usdG_;
        _reference = IPriceReference(reference_);
        _allow(allowed, uint64(block.timestamp));
    }

    // --- Allowed tokens -------------------------------------------------------------------

    /// @notice Allow tokens for new baskets and rebalances, e.g. newly issued Stock Tokens; applies after
    /// LISTING_DELAY. Tokens already allowed or pending keep their time.
    function allowTokens(address[] calldata tokens) external onlyOwner {
        _allow(tokens, uint64(block.timestamp + LISTING_DELAY));
    }

    /// @notice Immediately stop new baskets, purchases and rebalances from buying a token. Holding, redeeming and
    /// selling it are never blocked; rebalancing out of it still needs a reference price for it.
    function disallowTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (allowedAt[tokens[i]] == 0) continue;
            allowedAt[tokens[i]] = 0;
            emit TokenDisallowed(tokens[i]);
        }
    }

    function isAllowedToken(address token) public view returns (bool) {
        uint64 at = allowedAt[token];
        return at != 0 && block.timestamp >= at;
    }

    /// @notice Every token ever allowed, including disallowed ones; check `isAllowedToken` for status.
    function allowedTokens() external view returns (address[] memory) {
        return _allowedTokens;
    }

    function allowedTokenCount() external view returns (uint256) {
        return _allowedTokens.length;
    }

    // --- Baskets --------------------------------------------------------------------------

    function createBasket(
        string calldata name,
        string calldata symbol,
        BasqitToken.Component[] calldata components,
        uint16 feeBps,
        Management calldata management
    ) external returns (address basket) {
        if (feeBps > MAX_CREATOR_FEE_BPS) revert FeeTooHigh(feeBps);
        for (uint256 i = 0; i < components.length; i++) {
            if (!isAllowedToken(components[i].token)) revert UnlistedToken(components[i].token);
        }
        address manager;
        if (management.managed) {
            if (management.noticeHours > MAX_NOTICE_HOURS) revert NoticeTooLong(management.noticeHours);
            if (management.maxSlippageBps > MAX_SLIPPAGE_BPS || management.maxSlippageBps < MIN_SLIPPAGE_BPS) {
                revert SlippageOutOfRange(management.maxSlippageBps);
            }
            manager = msg.sender;
        } else if (management.noticeHours != 0 || management.maxSlippageBps != 0) {
            revert UnmanagedSettings();
        }
        basket = address(
            new BasqitToken(
                name, symbol, components, manager, uint32(management.noticeHours) * 1 hours, management.maxSlippageBps
            )
        );
        isBasket[basket] = true;
        creatorOf[basket] = msg.sender;
        _fees[basket].bps = feeBps;
        _baskets.push(basket);
        emit BasketCreated(basket, msg.sender, name, symbol, feeBps);
        if (manager != address(0)) {
            emit BasketManagement(basket, manager, management.noticeHours, management.maxSlippageBps);
        }
    }

    function basketCount() external view returns (uint256) {
        return _baskets.length;
    }

    function basketAt(uint256 index) external view returns (address) {
        return _baskets[index];
    }

    function allBaskets() external view returns (address[] memory) {
        return _baskets;
    }

    // --- Managed-basket settings ----------------------------------------------------------

    /// @notice The price reference the rebalance guard uses right now.
    function priceReference() public view returns (IPriceReference) {
        return pendingReferenceAt != 0 && block.timestamp >= pendingReferenceAt ? pendingReference : _reference;
    }

    /// @notice A new reference applies after SETTINGS_CHANGE_DELAY and replaces any pending change.
    function schedulePriceReference(address reference_) external onlyOwner {
        if (reference_.code.length == 0) revert NotAContract(reference_);
        _reference = priceReference();
        pendingReference = IPriceReference(reference_);
        pendingReferenceAt = uint64(block.timestamp + SETTINGS_CHANGE_DELAY);
        emit PriceReferenceScheduled(reference_, pendingReferenceAt);
    }

    /// @notice The router that swaps for every managed basket's rebalance right now.
    function rebalanceRouter() public view returns (address) {
        return pendingRouterAt != 0 && block.timestamp >= pendingRouterAt ? pendingRouter : _router;
    }

    /// @notice The first router applies at once (it needs this factory's address, so it is set after deployment);
    /// a replacement, e.g. after a token freezes the old one, waits SETTINGS_CHANGE_DELAY.
    function scheduleRebalanceRouter(address router) external onlyOwner {
        if (router.code.length == 0) revert NotAContract(router);
        address current = rebalanceRouter();
        uint64 effectiveAt =
            current == address(0) ? uint64(block.timestamp) : uint64(block.timestamp + SETTINGS_CHANGE_DELAY);
        _router = current;
        pendingRouter = router;
        pendingRouterAt = effectiveAt;
        emit RebalanceRouterScheduled(router, effectiveAt);
    }

    // --- Creator fees ---------------------------------------------------------------------

    function setFeesEnabled(bool enabled) external onlyOwner {
        if (enabled && feesEnabledAt != 0) return; // already on or pending: keep the earlier time
        feesEnabledAt = enabled ? uint64(block.timestamp + FEE_CHANGE_DELAY) : 0;
        emit FeesEnabledScheduled(enabled, feesEnabledAt);
    }

    function feesEnabled() public view returns (bool) {
        return feesEnabledAt != 0 && block.timestamp >= feesEnabledAt;
    }

    /// @notice Announce a new fee; it applies after FEE_CHANGE_DELAY and replaces any pending change.
    function scheduleCreatorFee(address basket, uint16 bps) external {
        if (creatorOf[basket] != msg.sender) revert NotCreator(basket);
        if (bps > MAX_CREATOR_FEE_BPS) revert FeeTooHigh(bps);
        CreatorFee storage fee = _fees[basket];
        fee.bps = _currentBps(fee);
        fee.pendingBps = bps;
        fee.pendingAt = uint64(block.timestamp + FEE_CHANGE_DELAY);
        emit CreatorFeeScheduled(basket, bps, fee.pendingAt);
    }

    /// @notice Fee the routers charge right now: zero while fees are switched off.
    function creatorFee(address basket) external view returns (address creator, uint16 bps) {
        if (!isBasket[basket]) revert UnknownBasket(basket);
        creator = creatorOf[basket];
        bps = feesEnabled() ? _currentBps(_fees[basket]) : 0;
    }

    /// @notice Raw fee settings, independent of the global switch.
    function feeSchedule(address basket) external view returns (uint16 current, uint16 pending, uint64 pendingAt) {
        CreatorFee memory fee = _fees[basket];
        return (_currentBps(fee), fee.pendingBps, fee.pendingAt);
    }

    /// @notice Disabled: without an owner the token list, price reference and router could never change again.
    function _transferOwnership(address newOwner) internal override {
        // Renouncing (a zero owner) is disabled; `renounceOwnership` stays a normal write that reverts here.
        if (newOwner == address(0)) revert RenounceDisabled();
        super._transferOwnership(newOwner);
    }

    function _currentBps(CreatorFee memory fee) private view returns (uint16) {
        return fee.pendingAt != 0 && block.timestamp >= fee.pendingAt ? fee.pendingBps : fee.bps;
    }

    function _allow(address[] memory tokens, uint64 effectiveAt) private {
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            if (allowedAt[token] != 0) continue;
            if (!_seen[token]) {
                _seen[token] = true;
                _allowedTokens.push(token);
            }
            allowedAt[token] = effectiveAt;
            emit TokenAllowed(token, effectiveAt);
        }
    }
}
