// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Buys an exact output amount. Pulls at most `maxAmountIn` from the caller and
/// returns the amount actually spent; anything unspent stays with (or returns to) the caller.
interface IExactOutputAdapter {
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata routeData
    ) external returns (uint256 amountIn);
}
