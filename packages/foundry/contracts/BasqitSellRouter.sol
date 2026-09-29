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
import { BasqitRouterBase } from "./BasqitRouterBase.sol";
import { BasqitToken } from "./BasqitToken.sol";
import { IExactInputAdapter } from "./interfaces/IExactInputAdapter.sol";

/// @notice Redeems basket shares, sells every component for USDG, pays the creator fee and
/// the rest, all in one transaction.
contract BasqitSellRouter is BasqitRouterBase {
    using SafeERC20 for IERC20;

    struct SwapInstruction {
        address adapter;
        uint256 minAmountOut;
        bytes routeData;
    }

    event BasketSold(
        address indexed seller,
        address indexed recipient,
        address indexed basket,
        uint256 shares,
        uint256 usdGReceived,
        uint256 creatorFee
    );

    error DeadlineExpired(uint256 deadline);
    error BasketNotRegistered(address basket);
    error InstructionCountMismatch(uint256 expected, uint256 actual);
    error SwapUnderpaid(address token, uint256 received, uint256 minimum);
    error TotalOutputBelowMinimum(uint256 received, uint256 minimum);
    error ResidualTokenBalance(address token, uint256 expected, uint256 actual);

    constructor(address usdG_, address factory_, address initialOwner, address[] memory initialAdapters)
        BasqitRouterBase(usdG_, factory_, initialOwner, initialAdapters)
    { }

    /// @param minUsdGOut minimum paid to `recipient`, after the creator fee.
    function sellBasket(
        address basketAddress,
        uint256 shares,
        uint256 minUsdGOut,
        SwapInstruction[] calldata swaps,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 paid, uint256 fee) {
        if (!factory.isBasket(basketAddress)) revert BasketNotRegistered(basketAddress);
        if (shares == 0) revert ZeroAmount();
        _checkRecipient(recipient, basketAddress);
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);

        {
            uint256 usdGBefore = usdG.balanceOf(address(this));
            uint256 sharesBefore = IERC20(basketAddress).balanceOf(address(this));
            uint256 received = _redeemAndSell(basketAddress, shares, swaps);
            // Dust amounts that redeem to nothing would burn shares for no USDG.
            if (received == 0) revert ZeroAmount();
            uint256 accrued;
            (fee, accrued) = _chargeFee(basketAddress, received);
            paid = received - fee;
            if (paid < minUsdGOut) revert TotalOutputBelowMinimum(paid, minUsdGOut);
            usdG.safeTransfer(recipient, paid);
            _checkBalances(basketAddress, usdGBefore + accrued, sharesBefore);
        }
        emit BasketSold(msg.sender, recipient, basketAddress, shares, paid, fee);
    }

    function _redeemAndSell(address basketAddress, uint256 shares, SwapInstruction[] calldata swaps)
        private
        returns (uint256 received)
    {
        BasqitToken basket = BasqitToken(basketAddress);
        uint256[] memory amounts = basket.quoteRedeem(shares);
        if (swaps.length != amounts.length) revert InstructionCountMismatch(amounts.length, swaps.length);
        IERC20(basketAddress).safeTransferFrom(msg.sender, address(this), shares);
        basket.redeem(shares, address(this));
        for (uint256 i = 0; i < amounts.length; i++) {
            received += _sellComponent(basket.componentAt(i).token, amounts[i], swaps[i]);
        }
    }

    /// @dev Only an unpaid fee may stay; shares sent here by others never block sales.
    function _checkBalances(address basket, uint256 usdGExpected, uint256 sharesExpected) private view {
        uint256 usdGAfter = usdG.balanceOf(address(this));
        if (usdGAfter != usdGExpected) revert ResidualTokenBalance(address(usdG), usdGExpected, usdGAfter);
        uint256 sharesAfter = IERC20(basket).balanceOf(address(this));
        if (sharesAfter != sharesExpected) revert ResidualTokenBalance(basket, sharesExpected, sharesAfter);
    }

    function _sellComponent(address token, uint256 amountIn, SwapInstruction calldata swap)
        private
        returns (uint256 received)
    {
        _checkAdapter(swap.adapter);
        // Rounding can leave a component with nothing to sell; a per-leg minimum still applies.
        if (amountIn == 0) {
            if (swap.minAmountOut != 0) revert SwapUnderpaid(token, 0, swap.minAmountOut);
            return 0;
        }
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        uint256 usdGBefore = usdG.balanceOf(address(this));

        IERC20(token).forceApprove(swap.adapter, amountIn);
        IExactInputAdapter(swap.adapter)
            .swapExactInput(token, address(usdG), amountIn, swap.minAmountOut, address(this), swap.routeData);
        IERC20(token).forceApprove(swap.adapter, 0);

        uint256 tokenAfter = IERC20(token).balanceOf(address(this));
        if (tokenBefore - tokenAfter != amountIn) {
            revert UnexpectedTokenTransfer(token, tokenBefore - tokenAfter, amountIn);
        }
        received = usdG.balanceOf(address(this)) - usdGBefore;
        if (received < swap.minAmountOut) revert SwapUnderpaid(token, received, swap.minAmountOut);
    }
}
