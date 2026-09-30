//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { DeployBasqit } from "./DeployBasqit.s.sol";
import { DeployTestnet } from "./DeployTestnet.s.sol";

/**
 * @notice Main deployment script: `yarn deploy --network <network>`.
 *  - Robinhood Chain mainnet (4663): baskets only (`DeployBasqit`).
 *  - Robinhood Chain testnet (46630) and the local chain: everything with test tokens (`DeployTestnet`).
 * Afterwards `yarn verify --network <network>` verifies every contract in this script's broadcast.
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        if (block.chainid == 4663) new DeployBasqit().run();
        else new DeployTestnet().run();
    }
}
