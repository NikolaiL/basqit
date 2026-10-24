// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";

/// @notice Upgrade only the local payout schedule; existing openings and tokens are retained.
contract DeployPacks2PayoutSchedule is ScaffoldETHDeploy {
    function run() external {
        require(block.chainid == 31337, "Local fork only");
        BasqitPacks2 packs = BasqitPacks2(vm.envAddress("PACKS2_PROXY"));
        require(packs.configCount() == 9, "Independent stock selection required");
        deployer = _startBroadcast();
        require(packs.owner() == deployer, "Proxy owner only");
        packs.upgradeToAndCall(address(new BasqitPacks2()), abi.encodeCall(BasqitPacks2.initializePayoutSchedule, ()));
        _stopBroadcast();
    }
}
