// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Sells an exact input amount pulled from the caller for at least `minAmountOut`.
interface IExactInputAdapter {
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata routeData
    ) external returns (uint256 amountOut);
}
