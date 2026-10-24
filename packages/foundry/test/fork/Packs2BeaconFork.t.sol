// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { DeployPacks2Beacon } from "../../script/DeployPacks2Beacon.s.sol";

interface IVerifier {
    function verify(uint64 round, bytes calldata signature) external view returns (bool);
    function prove(uint64 round, bytes calldata signature) external returns (bytes32);
    function latestRound() external view returns (uint64);
}

contract Packs2BeaconForkTest is Test {
    function test_verifiedRuntimeDeploymentAndRealSignature() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        vm.chainId(46630);
        address original = 0xb7133cCaba74EB06292b9232A1723Bc31eDAAC51;
        vm.setEnv("PACKS2_BEACON_RUNTIME", vm.toString(original.code));
        address deployed = (new DeployPacks2Beacon()).run();
        assertEq(deployed.codehash, original.codehash);
        IVerifier verifier = IVerifier(deployed);
        assertEq(verifier.latestRound(), 0);
        bytes memory signature =
            hex"2c83c8b5c46883ed5bb078ec04948023da5f6f07baee9d7ff6fcaf8cebd206a51c695111d5c63d7c90d338c478c884e82bfbaab493ca559e728bca1aac7c4610";
        assertTrue(verifier.verify(21771010, signature));
        assertFalse(verifier.verify(21771011, signature));
        assertEq(verifier.prove(21771010, signature), sha256(signature));
        assertEq(verifier.latestRound(), 21771010);
        DeployPacks2Beacon invalid = new DeployPacks2Beacon();
        vm.setEnv("PACKS2_BEACON_RUNTIME", "0x00");
        vm.expectRevert("Unverified drand verifier");
        invalid.run();
    }
}
