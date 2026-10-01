// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployHelpers.s.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../contracts/BasqitSellRouter.sol";
import { BasqitRebalanceRouter } from "../contracts/BasqitRebalanceRouter.sol";
import { UniswapV3Adapter } from "../contracts/adapters/UniswapV3Adapter.sol";

/**
 * @notice Deploys the Basqit factory, routers and the Uniswap v3 adapter on Robinhood Chain (4663): real USDG and
 * every active Stock Token from `stock-tokens-4663.json`. Creator fees stay switched off. Testnet and local
 * deployments are `DeployTestnet`.
 *
 * yarn deploy --network robinhood
 */
contract DeployBasqit is ScaffoldETHDeploy {
    address internal constant USDG_4663 = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant SWAP_ROUTER_02_4663 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    error UnsupportedNetwork(uint256 chainId);

    function run() external ScaffoldEthDeployerRunner {
        if (block.chainid == 4663) _deployRobinhood();
        else revert UnsupportedNetwork(block.chainid);
    }

    function _deployRobinhood() internal {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/script/stock-tokens-4663.json"));
        address[] memory tokens = vm.parseJsonAddressArray(json, ".addresses");
        // USDG is allowed at once; Stock Tokens are allowed in chunks of 100 (~7M gas each) instead of one ~21M-gas
        // constructor transaction, so they become usable after LISTING_DELAY. WETH waits for a verified address.
        // No price reference yet: managed baskets cannot rebalance until a feed-backed one is scheduled.
        address[] memory usdG = new address[](1);
        usdG[0] = USDG_4663;
        BasqitFactory factory = new BasqitFactory(deployer, USDG_4663, usdG, address(0));
        for (uint256 start = 0; start < tokens.length; start += 100) {
            uint256 end = start + 100 < tokens.length ? start + 100 : tokens.length;
            address[] memory chunk = new address[](end - start);
            for (uint256 i = start; i < end; i++) {
                chunk[i - start] = tokens[i];
            }
            factory.allowTokens(chunk);
        }
        _routers(USDG_4663, factory, address(new UniswapV3Adapter(SWAP_ROUTER_02_4663)));
    }

    function _routers(address usdG, BasqitFactory factory, address adapter) internal {
        address[] memory adapters = new address[](1);
        adapters[0] = adapter;
        new BasqitPurchaseRouter(usdG, address(factory), deployer, adapters);
        new BasqitSellRouter(usdG, address(factory), deployer, adapters);
        factory.scheduleRebalanceRouter(address(new BasqitRebalanceRouter(usdG, address(factory), deployer, adapters)));
    }
}
