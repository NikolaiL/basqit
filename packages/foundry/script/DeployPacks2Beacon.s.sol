// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";

/// @notice Reuse the verified, constructor-free evmnet verifier runtime on Robinhood testnet.
contract DeployPacks2Beacon is ScaffoldETHDeploy {
    function run() external returns (address beacon) {
        require(block.chainid == 46630, "Robinhood testnet only");
        bytes memory runtime = vm.envBytes("PACKS2_BEACON_RUNTIME");
        bytes32 expected = 0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924;
        require(keccak256(runtime) == expected, "Unverified drand verifier");
        _startBroadcast();
        beacon = address(new Packs2BeaconRuntime(runtime));
        require(beacon.codehash == expected, "Wrong deployed verifier");
        _stopBroadcast();
    }
}

contract Packs2BeaconRuntime {
    constructor(bytes memory runtime) {
        assembly {
            return(add(runtime, 32), mload(runtime))
        }
    }
}
