// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";

/// @notice Upgrade the existing local proxy without replacing tokens, funding or prior terms.
contract DeployPacks2StockSelection is ScaffoldETHDeploy {
    function run() external {
        require(block.chainid == 31337, "Local fork only");
        BasqitPacks2 packs = BasqitPacks2(vm.envAddress("PACKS2_PROXY"));
        require(packs.configCount() == 6, "Mixed catalog required");
        deployer = _startBroadcast();
        require(packs.owner() == deployer, "Proxy owner only");
        BasqitPacks2 implementation = new BasqitPacks2();
        packs.upgradeToAndCall(address(implementation), abi.encodeCall(BasqitPacks2.initializeStockSelection, ()));
        _stopBroadcast();
    }
}
