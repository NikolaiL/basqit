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

/// @notice Creates Basqit baskets from an owner-curated list of Stock Tokens and
/// records each basket's creator and creator fee.
contract BasqitFactory is Ownable2Step {
    /// @notice Creator fees are capped at 1% of the USDG spent or received.
    uint16 public constant MAX_CREATOR_FEE_BPS = 100;
    /// @notice Fee changes take effect only after this delay, so buyers can see them coming.
    uint256 public constant FEE_CHANGE_DELAY = 1 days;

    struct CreatorFee {
        uint16 bps;
        uint16 pendingBps;
        uint64 pendingAt;
    }

    mapping(address token => bool) public isStockToken;
    // Keeps `_stockTokens` free of duplicates when a delisted token is listed again.
    mapping(address token => bool) private _seen;
    address[] private _stockTokens;

    mapping(address basket => bool) public isBasket;
    mapping(address basket => address) public creatorOf;
    mapping(address basket => CreatorFee) private _fees;
    address[] private _baskets;

    /// @notice When creator fees switch on (0 = off). Switching on waits FEE_CHANGE_DELAY like any
    /// other fee change; switching off is immediate.
    uint64 public feesEnabledAt;

    event StockTokenListed(address indexed token);
    event StockTokenDelisted(address indexed token);
    event BasketCreated(address indexed basket, address indexed creator, string name, string symbol, uint16 feeBps);
    event CreatorFeeScheduled(address indexed basket, uint16 bps, uint64 effectiveAt);
    event FeesEnabledScheduled(bool enabled, uint64 effectiveAt);

    error ZeroAddress();
    error UnlistedToken(address token);
    error FeeTooHigh(uint16 bps);
    error NotCreator(address basket);
    error UnknownBasket(address basket);
    error RenounceDisabled();

    constructor(address initialOwner, address[] memory stockTokens_) Ownable(initialOwner) {
        _list(stockTokens_);
    }

    // --- Stock Token registry -------------------------------------------------------------

    /// @notice List Stock Tokens that new baskets may hold, e.g. newly issued ones.
    function listStockTokens(address[] calldata tokens) external onlyOwner {
        _list(tokens);
    }

    /// @notice Stop new baskets from using a token. Existing baskets are immutable and unaffected.
    function delistStockTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (!isStockToken[tokens[i]]) continue;
            isStockToken[tokens[i]] = false;
            emit StockTokenDelisted(tokens[i]);
        }
    }

    /// @notice Every token ever listed, including delisted ones; check `isStockToken` for status.
    function stockTokens() external view returns (address[] memory) {
        return _stockTokens;
    }

    function stockTokenCount() external view returns (uint256) {
        return _stockTokens.length;
    }

    // --- Baskets --------------------------------------------------------------------------

    function createBasket(
        string calldata name,
        string calldata symbol,
        BasqitToken.Component[] calldata components,
        uint16 feeBps
    ) external returns (address basket) {
        if (feeBps > MAX_CREATOR_FEE_BPS) revert FeeTooHigh(feeBps);
        for (uint256 i = 0; i < components.length; i++) {
            if (!isStockToken[components[i].token]) revert UnlistedToken(components[i].token);
        }
        basket = address(new BasqitToken(name, symbol, components));
        isBasket[basket] = true;
        creatorOf[basket] = msg.sender;
        _fees[basket].bps = feeBps;
        _baskets.push(basket);
        emit BasketCreated(basket, msg.sender, name, symbol, feeBps);
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

    /// @notice Disabled: without an owner the adapter and token lists could never change again.
    function _transferOwnership(address newOwner) internal override {
        // Renouncing (a zero owner) is disabled; `renounceOwnership` stays a normal write that reverts here.
        if (newOwner == address(0)) revert RenounceDisabled();
        super._transferOwnership(newOwner);
    }

    function _currentBps(CreatorFee memory fee) private view returns (uint16) {
        return fee.pendingAt != 0 && block.timestamp >= fee.pendingAt ? fee.pendingBps : fee.bps;
    }

    function _list(address[] memory tokens) private {
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            if (isStockToken[token]) continue;
            if (!_everListed(token)) _stockTokens.push(token);
            isStockToken[token] = true;
            emit StockTokenListed(token);
        }
    }

    function _everListed(address token) private returns (bool seen) {
        seen = _seen[token];
        _seen[token] = true;
    }
}
