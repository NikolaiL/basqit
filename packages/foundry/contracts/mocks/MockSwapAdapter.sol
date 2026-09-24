// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IExactInputAdapter } from "../interfaces/IExactInputAdapter.sol";
import { IExactOutputAdapter } from "../interfaces/IExactOutputAdapter.sol";

/// @notice Local-only venue that trades Stock Tokens against USDG at fixed prices from its own
/// inventory. Buys round up, sells round down. Refuses to deploy on Robinhood Chain mainnet.
contract MockSwapAdapter is IExactInputAdapter, IExactOutputAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdG;
    /// @notice USDG (6 decimals) per whole token (1e18 units).
    mapping(address token => uint256) public priceUsdG;

    error UnsupportedChain();
    error UnsupportedToken(address token);
    error ExcessiveInput(uint256 amountIn, uint256 maximum);
    error InsufficientOutput(uint256 amountOut, uint256 minimum);

    constructor(address usdG_) {
        if (block.chainid == 4663) revert UnsupportedChain();
        usdG = IERC20(usdG_);
    }

    function setPrice(address token, uint256 price) external {
        priceUsdG[token] = price;
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata
    ) external returns (uint256 amountIn) {
        if (tokenIn != address(usdG) || priceUsdG[tokenOut] == 0) {
            revert UnsupportedToken(tokenOut);
        }
        amountIn = Math.mulDiv(amountOut, priceUsdG[tokenOut], 1e18, Math.Rounding.Ceil);
        if (amountIn > maxAmountIn) revert ExcessiveInput(amountIn, maxAmountIn);
        usdG.safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata
    ) external returns (uint256 amountOut) {
        if (tokenOut != address(usdG) || priceUsdG[tokenIn] == 0) {
            revert UnsupportedToken(tokenIn);
        }
        amountOut = Math.mulDiv(amountIn, priceUsdG[tokenIn], 1e18);
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        usdG.safeTransfer(recipient, amountOut);
    }
}
