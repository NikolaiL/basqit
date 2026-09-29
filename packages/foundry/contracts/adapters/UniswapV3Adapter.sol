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
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IExactInputAdapter } from "../interfaces/IExactInputAdapter.sol";
import { IExactOutputAdapter } from "../interfaces/IExactOutputAdapter.sol";

/// @dev Uniswap SwapRouter02 single-pool swaps (no deadline field; the Basqit routers enforce one).
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
}

/// @notice Stateless adapter from the Basqit routers to one Uniswap v3 pool per swap.
/// `routeData` is `abi.encode(uint24 fee)` choosing the pool's fee tier; quotes come from QuoterV2
/// off chain. It holds nothing between calls: unspent input is returned to the caller.
contract UniswapV3Adapter is IExactInputAdapter, IExactOutputAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable swapRouter;

    error ZeroAddress();
    error PartialFill(uint256 unsold);

    constructor(address swapRouter_) {
        if (swapRouter_ == address(0)) revert ZeroAddress();
        swapRouter = ISwapRouter02(swapRouter_);
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata routeData
    ) external nonReentrant returns (uint256 amountIn) {
        if (recipient == address(0)) revert ZeroAddress();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), maxAmountIn);
        amountIn = swapRouter.exactOutputSingle(
            ISwapRouter02.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: abi.decode(routeData, (uint24)),
                recipient: recipient,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        if (maxAmountIn > amountIn) IERC20(tokenIn).safeTransfer(msg.sender, maxAmountIn - amountIn);
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata routeData
    ) external nonReentrant returns (uint256 amountOut) {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: abi.decode(routeData, (uint24)),
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        // A thin v3 pool can run out of liquidity and take only part of the input; sell all or nothing.
        uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));
        if (balanceAfter != balanceBefore) revert PartialFill(balanceAfter - balanceBefore);
    }
}
