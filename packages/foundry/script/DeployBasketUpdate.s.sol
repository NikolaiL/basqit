// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployTestnet.s.sol";

/// @notice Replace the testnet factory and its dependents while retaining tokens, faucet, swap venue and packs.
/// Set EXISTING_FACTORY and EXISTING_SWAP_ADAPTER to the deployment being replaced.
contract DeployBasketUpdate is DeployTestnet {
    function run() external override ScaffoldEthDeployerRunner {
        require(block.chainid == 46630, "Testnet only");
        BasqitFactory previous = BasqitFactory(vm.envAddress("EXISTING_FACTORY"));
        shop = TestnetSwapAdapter(vm.envAddress("EXISTING_SWAP_ADAPTER"));
        usdg = TestnetToken(previous.usdG());
        require(previous.owner() == deployer && shop.owner() == deployer, "Wrong deployer");
        require(address(shop.usdG()) == address(usdg), "Payment token mismatch");

        address[] memory listed = previous.allowedTokens();
        string[5] memory symbols = ["tNVDA", "tAAPL", "tTSLA", "tAMZN", "tMETA"];
        for (uint256 i = 0; i < listed.length; i++) {
            require(previous.isAllowedToken(listed[i]), "Inactive token in source registry");
            bytes32 symbol = keccak256(bytes(TestnetToken(listed[i]).symbol()));
            for (uint256 j = 0; j < 5; j++) {
                if (symbol == keccak256(bytes(symbols[j]))) stocks[j] = TestnetToken(listed[i]);
            }
        }
        for (uint256 i = 0; i < 5; i++) {
            require(address(stocks[i]) != address(0), "Missing sample token");
        }

        factory = new BasqitFactory(deployer, address(usdg), listed, address(shop));
        _baskets();
        BasqitGifts gifts = new BasqitGifts(deployer, address(factory));
        new BasqitGiftRouter(address(usdg), address(factory), address(gifts), deployer, _adapters());
    }
}
