// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";

/// @notice Extend the existing local catalog while retaining every purchased configuration.
contract DeployPacks2Mixed is ScaffoldETHDeploy {
    function run() external {
        require(block.chainid == 31337, "Local fork only");
        BasqitPacks2 packs = BasqitPacks2(vm.envAddress("PACKS2_PROXY"));
        address[5] memory tokens;
        tokens[0] = vm.envAddress("PACKS2_STOCK_TOKEN");
        require(packs.packConfig(packs.currentConfigId(1)).tiers[0].token == tokens[0], "Wrong stock token");
        uint256[5] memory references = [
            vm.envUint("PACKS2_NVDA_REFERENCE"),
            vm.envUint("PACKS2_AAPL_REFERENCE"),
            vm.envUint("PACKS2_MSFT_REFERENCE"),
            vm.envUint("PACKS2_AMZN_REFERENCE"),
            vm.envUint("PACKS2_TSLA_REFERENCE")
        ];
        deployer = _startBroadcast();
        require(packs.owner() == deployer, "Proxy owner only");
        require(packs.configCount() == 3, "Mixed catalog already configured");
        string[4] memory names = ["Apple", "Microsoft", "Amazon", "Tesla"];
        string[4] memory symbols = ["tAAPL", "tMSFT", "tAMZN", "tTSLA"];
        for (uint256 i; i < 4; i++) {
            TestnetToken token =
                new TestnetToken(string.concat("Packs2 Test ", names[i], " (no value)"), symbols[i], 18, deployer);
            BasqitTestnetFaucet faucet = new BasqitTestnetFaucet(address(token), 100e18, 1 minutes, 10_000e18);
            token.setMinter(address(faucet), true);
            tokens[i + 1] = address(token);
        }
        BasqitPacks2 implementation = new BasqitPacks2();
        packs.upgradeToAndCall(
            address(implementation), abi.encodeCall(BasqitPacks2.initializeMixedPackTypes, (tokens, references))
        );
        // Seed only the newly created test assets; existing vault inventory is retained.
        for (uint256 i = 1; i < 5; i++) {
            TestnetToken(tokens[i]).mint(address(packs), 100e18);
        }
        _stopBroadcast();
    }
}
