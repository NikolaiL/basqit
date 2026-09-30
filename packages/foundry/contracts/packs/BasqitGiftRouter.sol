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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { BasqitRouterBase } from "../BasqitRouterBase.sol";
import { BasqitGifts } from "./BasqitGifts.sol";

/// @notice Buys Stock Tokens with USDG through allowed adapters and seals them into a gift for the recipient, all in
/// one transaction. Charges the Basqit fee on what was spent and refunds the rest of the budget. Off-chain readers
/// should follow `activeGifts()` and index every gifts contract named in `GiftsChanged`; the fee recipient claims
/// unpaid fees through the base's `claimFees`, where it is called the creator. The gifts contract
/// it seals into can be replaced after a delay, and new ways to buy are new adapters, so this router can grow
/// without touching gifts already sealed.
contract BasqitGiftRouter is BasqitRouterBase {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 500;

    struct Purchase {
        address token;
        uint256 amount;
        address adapter;
        uint256 maxAmountIn;
        bytes routeData;
    }

    BasqitGifts public gifts;
    address public pendingGifts;
    uint64 public pendingGiftsAt;
    address public feeRecipient;
    uint16 public feeBps;

    event GiftBought(
        address indexed buyer,
        address indexed recipient,
        uint256 indexed giftId,
        uint256 usdGSpent,
        uint256 fee,
        uint256 usdGRefunded
    );
    event GiftsScheduled(address indexed next, uint64 effectiveAt);
    event GiftsChanged(address indexed gifts);
    event FeeSet(address indexed recipient, uint16 bps);
    event GiftFeePaid(address indexed recipient, uint256 amount, bool accrued);

    error DeadlineExpired(uint256 deadline);
    error BadPurchases(uint256 count);
    error FeeTooHigh(uint16 bps);
    error TotalSpendExceeded(uint256 spent, uint256 maximum);
    error ResidualTokenBalance(address token, uint256 expected, uint256 actual);
    error GiftsMismatch(address expected, address actual);
    error FeeAboveMax(uint16 bps, uint16 maxBps);
    error NotGiftListed(address token);
    error NotAGiftsContract(address next);

    constructor(address usdG_, address factory_, address gifts_, address initialOwner, address[] memory initialAdapters)
        BasqitRouterBase(usdG_, factory_, initialOwner, initialAdapters)
    {
        if (gifts_ == address(0)) revert ZeroAddress();
        gifts = BasqitGifts(gifts_);
        feeRecipient = initialOwner;
        emit GiftsChanged(gifts_);
    }

    /// @notice Points the router at another gifts contract after ADAPTER_DELAY, so buyers can see it coming.
    function scheduleGifts(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        _applyPendingGifts(); // a change already due is applied, never silently dropped
        if (next.code.length == 0) revert NotAGiftsContract(next);
        BasqitGifts(next).MAX_ITEMS(); // reverts for a contract that is not a gifts contract
        pendingGifts = next;
        pendingGiftsAt = uint64(block.timestamp + ADAPTER_DELAY);
        emit GiftsScheduled(next, pendingGiftsAt);
    }

    /// @notice Drops a scheduled change that is not due yet.
    function cancelPendingGifts() external onlyOwner {
        _applyPendingGifts();
        pendingGifts = address(0);
        pendingGiftsAt = 0;
        emit GiftsScheduled(address(0), 0);
    }

    /// @notice The fee buyers see before they confirm; capped at MAX_FEE_BPS and bounded by each buyer's budget.
    /// Guarded so a receiver callback during `buyGift` cannot raise the fee after the buyer's cap was checked.
    function setFee(address recipient, uint16 bps) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this)) revert InvalidRecipient(recipient);
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps);
        feeRecipient = recipient;
        feeBps = bps;
        emit FeeSet(recipient, bps);
    }

    /// @notice The gifts contract purchases are sealed into right now, including a scheduled change that is due.
    function activeGifts() public view returns (BasqitGifts) {
        return pendingGifts != address(0) && block.timestamp >= pendingGiftsAt ? BasqitGifts(pendingGifts) : gifts;
    }

    /// @param maxUsdGIn total budget including the fee; the unspent rest is refunded.
    /// @param maxFeeBps the highest fee the buyer accepts, so a fee change cannot surprise them.
    /// @param expectedGifts the gifts contract the buyer expects their gift in, so a switch cannot surprise them.
    function buyGift(
        Purchase[] calldata purchases,
        uint256 maxUsdGIn,
        uint16 maxFeeBps,
        address expectedGifts,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 giftId, uint256 spent, uint256 fee, uint256 refunded) {
        BasqitGifts target = _guard(expectedGifts, maxFeeBps);
        if (purchases.length == 0 || purchases.length > target.MAX_ITEMS()) revert BadPurchases(purchases.length);
        if (maxUsdGIn == 0) revert ZeroAmount();
        _checkRecipient(recipient, address(target));
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);

        uint256 usdGBefore = _pullUsdG(maxUsdGIn);

        (giftId, spent) = _buyAndWrap(target, purchases, maxUsdGIn, recipient);
        (fee, refunded) = _settle(spent, maxUsdGIn, usdGBefore);
        emit GiftBought(msg.sender, recipient, giftId, spent, fee, refunded);
    }

    function _guard(address expectedGifts, uint16 maxFeeBps) private returns (BasqitGifts target) {
        target = _applyPendingGifts();
        if (address(target) != expectedGifts) revert GiftsMismatch(expectedGifts, address(target));
        if (feeBps > maxFeeBps) revert FeeAboveMax(feeBps, maxFeeBps);
    }

    /// @dev Buys every leg, then seals them. Balances are compared with their starting values, so tokens sent here
    /// by anyone else can neither block purchases nor be swept into a gift.
    function _buyAndWrap(BasqitGifts target, Purchase[] calldata purchases, uint256 budget, address recipient)
        private
        returns (uint256 giftId, uint256 spent)
    {
        BasqitGifts.Item[] memory items = new BasqitGifts.Item[](purchases.length);
        uint256[] memory startBalances = new uint256[](purchases.length);
        for (uint256 i = 0; i < purchases.length; i++) {
            Purchase calldata p = purchases[i];
            // The gifts contract's list (the factory's), checked before any swap.
            if (!target.isListed(p.token)) revert NotGiftListed(p.token);
            // A repeated token would only fail in `wrap`, after every swap had run.
            for (uint256 j = 0; j < i; j++) {
                if (purchases[j].token == p.token) revert BasqitGifts.DuplicateToken(p.token);
            }
            startBalances[i] = IERC20(p.token).balanceOf(address(this));
            // A leg can never reach past the buyer's remaining budget into other funds.
            spent += _buyExactOutput(p.token, p.amount, p.adapter, Math.min(p.maxAmountIn, budget - spent), p.routeData);
            items[i] = BasqitGifts.Item(p.token, p.amount);
        }
        // Approvals only after every swap, just before sealing.
        for (uint256 i = 0; i < purchases.length; i++) {
            IERC20(purchases[i].token).forceApprove(address(target), purchases[i].amount);
        }
        giftId = target.wrap(items, recipient);
        for (uint256 i = 0; i < purchases.length; i++) {
            address token = purchases[i].token;
            IERC20(token).forceApprove(address(target), 0);
            uint256 actual = IERC20(token).balanceOf(address(this));
            if (actual != startBalances[i]) revert ResidualTokenBalance(token, startBalances[i], actual);
        }
    }

    /// @dev Charges the fee within the budget, refunds the rest, and checks that the only USDG left behind is a fee
    /// that could not be paid out.
    function _settle(uint256 spent, uint256 budget, uint256 usdGBefore)
        private
        returns (uint256 fee, uint256 refunded)
    {
        uint256 accrued;
        (fee, accrued) = _chargeGiftFee(spent);
        if (spent + fee > budget) revert TotalSpendExceeded(spent + fee, budget);
        refunded = budget - spent - fee;
        if (refunded > 0) usdG.safeTransfer(msg.sender, refunded);
        uint256 left = usdG.balanceOf(address(this));
        if (left != usdGBefore + accrued) revert ResidualTokenBalance(address(usdG), usdGBefore + accrued, left);
    }

    function _applyPendingGifts() private returns (BasqitGifts) {
        if (pendingGifts != address(0) && block.timestamp >= pendingGiftsAt) {
            gifts = BasqitGifts(pendingGifts);
            pendingGifts = address(0);
            pendingGiftsAt = 0;
            emit GiftsChanged(address(gifts));
        }
        return gifts;
    }

    /// @dev Fee rounds up and goes out right away; if the transfer fails it is kept for `claimFees`.
    function _chargeGiftFee(uint256 spent) private returns (uint256 fee, uint256 accrued) {
        fee = Math.mulDiv(spent, feeBps, 10_000, Math.Rounding.Ceil);
        if (fee == 0) return (0, 0);
        address to = feeRecipient;
        if (!usdG.trySafeTransfer(to, fee)) {
            accrued = fee;
            claimableFees[to] += fee;
        }
        emit GiftFeePaid(to, fee, accrued != 0);
    }
}
