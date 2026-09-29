// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployHelpers.s.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../contracts/BasqitSellRouter.sol";
import { BasqitToken } from "../contracts/BasqitToken.sol";
import { UniswapV3Adapter } from "../contracts/adapters/UniswapV3Adapter.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";

/**
 * @notice Deploys the Basqit factory, routers and a swap adapter.
 *  - Local chain (31337): mock USDG, three mock Stock Tokens, a fixed-price mock venue and a sample
 *    basket, so everything can be tried from /debug.
 *  - Robinhood Chain (4663): real USDG, every active Stock Token from `stock-tokens-4663.json`
 *    and the Uniswap v3 adapter. Creator fees stay switched off.
 *
 * yarn deploy --file DeployBasqit.s.sol
 * yarn deploy --file DeployBasqit.s.sol --network robinhood
 */
contract DeployBasqit is ScaffoldETHDeploy {
    address internal constant USDG_4663 = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant SWAP_ROUTER_02_4663 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    error UnsupportedNetwork(uint256 chainId);

    function run() external ScaffoldEthDeployerRunner {
        if (block.chainid == 31337) _deployLocal();
        else if (block.chainid == 4663) _deployRobinhood();
        else revert UnsupportedNetwork(block.chainid);
    }

    function _deployRobinhood() internal {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/script/stock-tokens-4663.json"));
        address[] memory tokens = vm.parseJsonAddressArray(json, ".addresses");
        // Listed in chunks of 100 (~7M gas each) instead of one ~21M-gas constructor transaction.
        BasqitFactory factory = new BasqitFactory(deployer, new address[](0));
        for (uint256 start = 0; start < tokens.length; start += 100) {
            uint256 end = start + 100 < tokens.length ? start + 100 : tokens.length;
            address[] memory chunk = new address[](end - start);
            for (uint256 i = start; i < end; i++) {
                chunk[i - start] = tokens[i];
            }
            factory.listStockTokens(chunk);
        }
        _routers(USDG_4663, factory, address(new UniswapV3Adapter(SWAP_ROUTER_02_4663)));
    }

    function _deployLocal() internal {
        MockUSDG usdG = new MockUSDG();
        TestnetSwapAdapter venue = new TestnetSwapAdapter(address(usdG), deployer);
        string[3] memory symbols = ["TSLA", "NVDA", "AAPL"];
        uint256[3] memory prices = [uint256(400e6), 180e6, 340e6];
        address[] memory tokens = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            MockStockToken token = new MockStockToken(string.concat("Mock ", symbols[i]), symbols[i]);
            token.mint(address(venue), 10_000e18);
            venue.setPrice(address(token), prices[i]);
            tokens[i] = address(token);
        }
        usdG.mint(address(venue), 10_000_000e6);
        usdG.mint(deployer, 10_000e6);

        BasqitFactory factory = new BasqitFactory(deployer, tokens);
        _routers(address(usdG), factory, address(venue));

        BasqitToken.Component[] memory components = new BasqitToken.Component[](3);
        for (uint256 i = 0; i < 3; i++) {
            components[i] = BasqitToken.Component(tokens[i], 0.1e18);
        }
        factory.createBasket("Sample Trio", "TRIO", components, 50);
    }

    function _routers(address usdG, BasqitFactory factory, address adapter) internal {
        address[] memory adapters = new address[](1);
        adapters[0] = adapter;
        new BasqitPurchaseRouter(usdG, address(factory), deployer, adapters);
        new BasqitSellRouter(usdG, address(factory), deployer, adapters);
    }
}
