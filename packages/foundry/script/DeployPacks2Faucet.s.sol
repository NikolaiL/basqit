// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";

/// @notice Replace only the local payment faucet; existing tokens, pack proxy and balances are retained.
contract DeployPacks2Faucet is ScaffoldETHDeploy {
    function run() external {
        require(block.chainid == 31337, "Local fork only");
        TestnetToken payment = TestnetToken(vm.envAddress("PACKS2_PAYMENT_TOKEN"));
        address previous = vm.envAddress("PACKS2_PREVIOUS_FAUCET");
        require(address(BasqitTestnetFaucet(previous).token()) == address(payment), "Wrong faucet token");
        deployer = _startBroadcast();
        require(payment.owner() == deployer, "Token owner only");
        BasqitTestnetFaucet next = new BasqitTestnetFaucet(address(payment), 10_000e6, 1 minutes, 1_000_000e6);
        payment.setMinter(address(next), true);
        payment.setMinter(previous, false);
        _stopBroadcast();
    }
}
