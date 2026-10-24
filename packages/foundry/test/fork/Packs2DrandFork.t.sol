// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Test } from "forge-std/Test.sol";
import { BasqitPacks2 } from "../../contracts/packs/BasqitPacks2.sol";
import { TestnetToken } from "../../contracts/packs/TestnetToken.sol";
import { Packs2BeaconRuntime } from "../../script/DeployPacks2Beacon.s.sol";
import { IDrandBeacon } from "../../contracts/packs/IDrandBeacon.sol";

contract Packs2DrandForkTest is Test {
    // RPC and explorer verification recorded in basqit-docs, 24 October 2026.
    IDrandBeacon internal beacon;
    uint64 internal constant ROUND = 21771010;

    function _deploy(address payment, BasqitPacks2.Tier[] memory table) internal returns (BasqitPacks2) {
        return BasqitPacks2(
            address(
                new ERC1967Proxy(
                    address(new BasqitPacks2()),
                    abi.encodeCall(BasqitPacks2.initialize, (address(this), payment, address(beacon), 100_000, table))
                )
            )
        );
    }

    function test_fork_realSignatureShortageAndFundingRetry() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        vm.chainId(31337);
        address original = 0xb7133cCaba74EB06292b9232A1723Bc31eDAAC51;
        assertEq(original.codehash, 0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924);
        beacon = IDrandBeacon(address(new Packs2BeaconRuntime(original.code)));
        TestnetToken payment = new TestnetToken("Test Dollar", "tUSDG", 6, address(this));
        TestnetToken stock = new TestnetToken("Test Stock", "tSTOCK", 18, address(this));
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](1);
        table[0] = BasqitPacks2.Tier(address(stock), 1e18, 1000);
        BasqitPacks2 packs = _deploy(address(payment), table);
        payment.mint(address(this), 300_000);
        payment.approve(address(packs), 300_000);
        vm.warp(beacon.publishTime(ROUND) - 30);
        uint256 id = packs.open(1);
        uint256 second = packs.open(1);
        packs.initializeStarter(212_319_454);
        uint256 starter = packs.open(1);
        packs.initializePackTypes(212_319_454);
        payment.mint(address(this), 111e6);
        payment.approve(address(packs), 111e6);
        uint256[3] memory catalogOpenings;
        for (uint8 packType = 1; packType <= 3; packType++) {
            catalogOpenings[packType - 1] = packs.openPack(packType, 1, packs.currentConfigId(packType));
        }
        assertEq(packs.opening(id).round, ROUND);
        vm.warp(beacon.publishTime(ROUND));
        bytes memory signature =
            hex"2c83c8b5c46883ed5bb078ec04948023da5f6f07baee9d7ff6fcaf8cebd206a51c695111d5c63d7c90d338c478c884e82bfbaab493ca559e728bca1aac7c4610";
        vm.expectRevert();
        beacon.prove(ROUND + 1, signature);
        bytes memory wrong = bytes.concat(signature);
        wrong[0] = bytes1(uint8(wrong[0]) ^ 1);
        vm.expectRevert();
        packs.reveal(id, wrong);
        assertFalse(packs.opening(id).revealed);
        packs.reveal(id, signature);
        assertEq(beacon.randomness(ROUND), sha256(signature));
        packs.reveal(second, "");
        packs.reveal(starter, "");
        assertTrue(packs.opening(second).revealed);
        assertNotEq(packs.opening(id).seed, packs.opening(second).seed);
        bytes32 seed = packs.opening(id).seed;
        vm.expectPartialRevert(BasqitPacks2.VaultShort.selector);
        packs.claim(id, 0);
        stock.mint(address(packs), 1e18);
        packs.claim(id, 0);
        assertEq(packs.opening(id).seed, seed);
        assertEq(stock.balanceOf(address(this)), 1e18);
        (BasqitPacks2.Tier memory starterPrize,,) = packs.outcome(starter, 0);
        assertLt(starterPrize.amount, 1e18);
        stock.mint(address(packs), starterPrize.amount);
        packs.claimAll(starter);
        assertEq(stock.balanceOf(address(this)), 1e18 + starterPrize.amount);
        for (uint256 i; i < catalogOpenings.length; i++) {
            uint256 catalogId = catalogOpenings[i];
            assertEq(packs.opening(catalogId).round, ROUND);
            packs.reveal(catalogId, "");
            (BasqitPacks2.Tier memory prize, uint16 slot,) = packs.outcome(catalogId, 0);
            BasqitPacks2.PackConfig memory config = packs.openingTerms(catalogId);
            uint256 tier;
            while (slot >= config.tiers[tier].end) tier++;
            assertEq(prize.amount, config.tiers[tier].amount);
            stock.mint(address(packs), prize.amount);
            packs.claimAll(catalogId);
            assertEq(packs.opening(catalogId).claimed, 1);
        }
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(second);
        assertEq(packs.liabilities(address(stock)), 0);
        emit log_named_bytes32("Verified seed", seed);
    }

    function test_fork_maximumRevealWithRealProof() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        vm.chainId(31337);
        address original = 0xb7133cCaba74EB06292b9232A1723Bc31eDAAC51;
        assertEq(original.codehash, 0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924);
        beacon = IDrandBeacon(address(new Packs2BeaconRuntime(original.code)));
        TestnetToken payment = new TestnetToken("Test Dollar", "tUSDG", 6, address(this));
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](32);
        for (uint16 i; i < 32; i++) {
            TestnetToken stock = new TestnetToken("Test Stock", "tSTOCK", 18, address(this));
            table[i] = BasqitPacks2.Tier(address(stock), 1e18, i == 31 ? 1000 : (i + 1) * 31);
        }
        BasqitPacks2 packs = _deploy(address(payment), table);
        payment.mint(address(this), 10e6);
        payment.approve(address(packs), 10e6);
        vm.warp(beacon.publishTime(ROUND) - 30);
        uint256 id = packs.open(100);
        vm.warp(beacon.publishTime(ROUND));
        uint256 beforeGas = gasleft();
        packs.reveal(
            id,
            hex"2c83c8b5c46883ed5bb078ec04948023da5f6f07baee9d7ff6fcaf8cebd206a51c695111d5c63d7c90d338c478c884e82bfbaab493ca559e728bca1aac7c4610"
        );
        uint256 used = beforeGas - gasleft();
        assertTrue(packs.opening(id).revealed);
        assertLt(used, 5_000_000);
        emit log_named_uint("Reveal gas: 100 packs, 32 tokens and tiers, real proof", used);
        for (uint256 i; i < table.length; i++) {
            TestnetToken(table[i].token).mint(address(packs), 100e18);
        }
        packs.claimAll(id);
        assertEq(packs.opening(id).claimed, (uint256(1) << 100) - 1);
        for (uint256 i; i < table.length; i++) {
            assertEq(packs.liabilities(table[i].token), 0);
        }
    }
}
