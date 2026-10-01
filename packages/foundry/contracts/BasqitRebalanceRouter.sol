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
import { IBasqitRebalanceRouter } from "./interfaces/IBasqitRebalanceRouter.sol";
import { IExactInputAdapter } from "./interfaces/IExactInputAdapter.sol";

/// @notice Swaps for managed-basket rebalances: pulls the exact sold components from the calling basket, sells each
/// for USDG, splits the USDG across the bought tokens and returns everything to the basket. Keeps nothing; the
/// basket itself checks balances and the value guard.
contract BasqitRebalanceRouter is BasqitRouterBase, IBasqitRebalanceRouter {
    using SafeERC20 for IERC20;

    event BasketRebalanced(address indexed basket, uint256 usdGProceeds);

    error BasketNotRegistered(address basket);
    error LengthMismatch();
    error SwapUnderpaid(address token, uint256 received, uint256 minimum);
    error ResidualTokenBalance(address token, uint256 expected, uint256 actual);

    constructor(address usdG_, address factory_, address initialOwner, address[] memory initialAdapters)
        BasqitRouterBase(usdG_, factory_, initialOwner, initialAdapters)
    { }

    function rebalance(
        address[] calldata sellTokens,
        uint256[] calldata sellAmounts,
        address[] calldata buyTokens,
        uint16[] calldata buyBps,
        Leg[] calldata sellLegs,
        Leg[] calldata buyLegs
    ) external nonReentrant {
        if (!factory.isBasket(msg.sender)) revert BasketNotRegistered(msg.sender);
        if (
            sellAmounts.length != sellTokens.length || sellLegs.length != sellTokens.length
                || buyBps.length != buyTokens.length || buyLegs.length != buyTokens.length || buyTokens.length == 0
        ) revert LengthMismatch();

        uint256 usdGBefore = usdG.balanceOf(address(this));
        uint256 proceeds;
        for (uint256 i = 0; i < sellTokens.length; i++) {
            proceeds += _sell(sellTokens[i], sellAmounts[i], sellLegs[i]);
        }
        uint256 left = proceeds;
        for (uint256 i = 0; i < buyTokens.length; i++) {
            // The last buy takes the remainder, so rounding never strands USDG here.
            uint256 slice = i == buyTokens.length - 1 ? left : proceeds * buyBps[i] / 10_000;
            left -= slice;
            _buy(buyTokens[i], slice, buyLegs[i]);
        }
        uint256 usdGAfter = usdG.balanceOf(address(this));
        if (usdGAfter != usdGBefore) revert ResidualTokenBalance(address(usdG), usdGBefore, usdGAfter);
        emit BasketRebalanced(msg.sender, proceeds);
    }

    /// @dev Pulls `amount` from the basket and sells what actually arrived, so a transfer fee on the token cannot
    /// block selling out of it; the basket values the full amount, so any fee counts against its slippage limit.
    function _sell(address token, uint256 amount, Leg calldata leg) private returns (uint256) {
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (token == address(usdG) || received == 0) return received;
        uint256 out = _swap(token, address(usdG), received, leg);
        _checkResidual(token, before);
        return out;
    }

    /// @dev Spends `amount` USDG on `token` and sends what it bought to the basket.
    function _buy(address token, uint256 amount, Leg calldata leg) private {
        if (token == address(usdG) || amount == 0) {
            if (amount != 0) usdG.safeTransfer(msg.sender, amount);
            return;
        }
        uint256 before = IERC20(token).balanceOf(address(this));
        uint256 bought = _swap(address(usdG), token, amount, leg);
        IERC20(token).safeTransfer(msg.sender, bought);
        _checkResidual(token, before);
    }

    /// @dev One exact-input swap through an allowed adapter. Trusts balances, not the adapter's report, and leaves no
    /// allowance behind.
    function _swap(address tokenIn, address tokenOut, uint256 amountIn, Leg calldata leg)
        private
        returns (uint256 received)
    {
        _checkAdapter(leg.adapter);
        uint256 inBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(leg.adapter, amountIn);
        IExactInputAdapter(leg.adapter)
            .swapExactInput(tokenIn, tokenOut, amountIn, leg.minAmountOut, address(this), leg.routeData);
        IERC20(tokenIn).forceApprove(leg.adapter, 0);
        uint256 spent = inBefore - IERC20(tokenIn).balanceOf(address(this));
        if (spent != amountIn) revert UnexpectedTokenTransfer(tokenIn, spent, amountIn);
        received = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
        if (received < leg.minAmountOut) revert SwapUnderpaid(tokenOut, received, leg.minAmountOut);
    }

    function _checkResidual(address token, uint256 expected) private view {
        uint256 actual = IERC20(token).balanceOf(address(this));
        if (actual != expected) revert ResidualTokenBalance(token, expected, actual);
    }
}
