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
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IExactInputAdapter } from "../interfaces/IExactInputAdapter.sol";
import { IExactOutputAdapter } from "../interfaces/IExactOutputAdapter.sol";

/// @notice Testnet and local only: trades test Stock Tokens against test USDG from its own stock at owner-set prices,
/// standing in for Uniswap, which has no pools for test tokens. Buys round up, sells round down. Deploys only on
/// Robinhood Chain testnet and the local chain; also the venue for local basket deploys and tests.
contract TestnetSwapAdapter is IExactInputAdapter, IExactOutputAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdG;
    /// @notice USDG (6 decimals) per whole token (1e18 units); 0 means not sold.
    mapping(address token => uint256) public priceUsdG;

    event PriceSet(address indexed token, uint256 price);

    error NotTestnet();
    error UnsupportedToken(address token);
    error ExcessiveInput(uint256 amountIn, uint256 maximum);
    error InsufficientOutput(uint256 amountOut, uint256 minimum);
    error RenounceDisabled();

    constructor(address usdG_, address initialOwner) Ownable(initialOwner) {
        if (block.chainid != 46630 && block.chainid != 31337) revert NotTestnet();
        usdG = IERC20(usdG_);
    }

    function setPrice(address token, uint256 price) external onlyOwner {
        priceUsdG[token] = price;
        emit PriceSet(token, price);
    }

    /// @notice Takes back unsold stock or collected USDG.
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice USDG needed for `amountOut` of `token`, rounded up.
    function quote(address token, uint256 amountOut) public view returns (uint256) {
        uint256 price = priceUsdG[token];
        if (price == 0) revert UnsupportedToken(token);
        return Math.mulDiv(amountOut, price, 1e18, Math.Rounding.Ceil);
    }

    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient,
        bytes calldata
    ) external returns (uint256 amountIn) {
        if (tokenIn != address(usdG)) revert UnsupportedToken(tokenIn);
        amountIn = quote(tokenOut, amountOut);
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
        uint256 price = priceUsdG[tokenIn];
        if (tokenOut != address(usdG) || price == 0) revert UnsupportedToken(tokenIn);
        amountOut = Math.mulDiv(amountIn, price, 1e18);
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        usdG.safeTransfer(recipient, amountOut);
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
