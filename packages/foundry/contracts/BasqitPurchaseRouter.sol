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
import { BasqitRouterBase } from "./BasqitRouterBase.sol";
import { BasqitToken } from "./BasqitToken.sol";

/// @notice Turns a bounded USDG budget into the exact components for basket shares, mints them,
/// pays the creator fee and refunds unspent USDG, all in one transaction.
contract BasqitPurchaseRouter is BasqitRouterBase {
    using SafeERC20 for IERC20;

    struct SwapInstruction {
        address adapter;
        uint256 maxAmountIn;
        bytes routeData;
    }

    event BasketPurchased(
        address indexed buyer,
        address indexed recipient,
        address indexed basket,
        uint256 shares,
        uint256 usdGSpent,
        uint256 creatorFee,
        uint256 usdGRefunded
    );

    error DeadlineExpired(uint256 deadline);
    error BasketNotRegistered(address basket);
    error DelistedComponent(address token);
    error InstructionCountMismatch(uint256 expected, uint256 actual);
    error TotalSpendExceeded(uint256 spent, uint256 maximum);
    error ResidualTokenBalance(address token, uint256 expected, uint256 actual);

    constructor(address usdG_, address factory_, address initialOwner, address[] memory initialAdapters)
        BasqitRouterBase(usdG_, factory_, initialOwner, initialAdapters)
    { }

    /// @param maxUsdGIn total budget including the creator fee; the unspent rest is refunded.
    function buyBasket(
        address basketAddress,
        uint256 shares,
        uint256 maxUsdGIn,
        SwapInstruction[] calldata swaps,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 usdGSpent, uint256 fee, uint256 refunded) {
        if (!factory.isBasket(basketAddress)) revert BasketNotRegistered(basketAddress);
        if (shares == 0 || maxUsdGIn == 0) revert ZeroAmount();
        _checkRecipient(recipient, basketAddress);
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);

        uint256 usdGBefore = _pullUsdG(maxUsdGIn);
        usdGSpent = _buyAll(basketAddress, shares, swaps, maxUsdGIn, recipient);
        (fee, refunded) = _settle(basketAddress, usdGSpent, maxUsdGIn, usdGBefore);
        emit BasketPurchased(msg.sender, recipient, basketAddress, shares, usdGSpent, fee, refunded);
    }

    /// @dev Buys every component and mints the shares. Balances are compared with their starting
    /// values, so tokens sent here by anyone else can neither block purchases nor be swept by a buyer.
    function _buyAll(
        address basketAddress,
        uint256 shares,
        SwapInstruction[] calldata swaps,
        uint256 budget,
        address recipient
    ) private returns (uint256 spent) {
        BasqitToken basket = BasqitToken(basketAddress);
        uint256[] memory amounts = basket.quoteMint(shares);
        if (swaps.length != amounts.length) revert InstructionCountMismatch(amounts.length, swaps.length);
        BasqitToken.Component[] memory parts = basket.components(); // one call, not one per leg
        uint256[] memory startBalances = new uint256[](amounts.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            address token = parts[i].token;
            // Existing baskets stay redeemable and sellable, but a delisted token is not bought.
            if (!factory.isAllowedToken(token)) revert DelistedComponent(token);
            startBalances[i] = IERC20(token).balanceOf(address(this));
            // A leg can never reach past the buyer's remaining budget into other funds.
            spent += _buyComponent(token, amounts[i], swaps[i], budget - spent);
        }
        _mint(basket, parts, shares, recipient, amounts, startBalances);
    }

    /// @dev Charges the creator fee within the budget, refunds the rest, and checks that the only
    /// USDG left behind is a fee that could not be paid out.
    function _settle(address basket, uint256 spent, uint256 budget, uint256 usdGBefore)
        private
        returns (uint256 fee, uint256 refunded)
    {
        uint256 accrued;
        (fee, accrued) = _chargeFee(basket, spent);
        if (spent + fee > budget) revert TotalSpendExceeded(spent + fee, budget);
        refunded = budget - spent - fee;
        if (refunded > 0) usdG.safeTransfer(msg.sender, refunded);
        uint256 actual = usdG.balanceOf(address(this));
        if (actual != usdGBefore + accrued) revert ResidualTokenBalance(address(usdG), usdGBefore + accrued, actual);
    }

    /// @dev A USDG component needs no swap: it comes straight out of the budget and its instruction is ignored.
    function _buyComponent(address token, uint256 amountOut, SwapInstruction calldata swap, uint256 remaining)
        private
        returns (uint256)
    {
        if (token == address(usdG)) {
            if (amountOut > remaining) revert TotalSpendExceeded(amountOut, remaining);
            return amountOut;
        }
        return _buyExactOutput(token, amountOut, swap.adapter, Math.min(swap.maxAmountIn, remaining), swap.routeData);
    }

    function _mint(
        BasqitToken basket,
        BasqitToken.Component[] memory parts,
        uint256 shares,
        address recipient,
        uint256[] memory amounts,
        uint256[] memory startBalances
    ) private {
        for (uint256 i = 0; i < amounts.length; i++) {
            IERC20(parts[i].token).forceApprove(address(basket), amounts[i]);
        }
        basket.mint(shares, recipient);
        for (uint256 i = 0; i < amounts.length; i++) {
            IERC20 token = IERC20(parts[i].token);
            token.forceApprove(address(basket), 0);
            // USDG still holds the budget here; `_settle` checks it once the fee and refund are paid.
            if (address(token) == address(usdG)) continue;
            uint256 left = token.balanceOf(address(this));
            if (left != startBalances[i]) revert ResidualTokenBalance(address(token), startBalances[i], left);
        }
    }
}
