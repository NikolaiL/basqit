// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import {
    DeployPacks2SharedAssets,
    ISharedAssetFactory,
    ISharedAssetPrices
} from "../../script/DeployPacks2SharedAssets.s.sol";
import { BasqitPacks2 } from "../../contracts/packs/BasqitPacks2.sol";
import { TestnetToken } from "../../contracts/packs/TestnetToken.sol";

contract Packs2SharedAssetsForkTest is Test {
    address internal constant FACTORY = 0x8fEE1a09f997E410F588B3C9840a546Bb0F5A68f;
    address internal constant FAUCET = 0xDf4fc787C827539586A99a54B156c1CF035d8A2E;
    address internal constant IMPLEMENTATION = 0x9e32cF764d22e0d7F7532eb4612675a4520a948A;
    address internal constant PREVIOUS = 0x63C00F18FC82e197dbA85DA2B62d71E47Ae64E60;
    address internal owner;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        vm.setEnv("PACKS2_SHARED_FACTORY", vm.toString(FACTORY));
        vm.setEnv("PACKS2_SHARED_FAUCET", vm.toString(FAUCET));
        vm.setEnv("PACKS2_IMPLEMENTATION", vm.toString(IMPLEMENTATION));
        vm.setEnv("PACKS2_IMPLEMENTATION_CODEHASH", vm.toString(IMPLEMENTATION.codehash));
        vm.setEnv("PACKS2_DRAND_BEACON", vm.toString(address(BasqitPacks2(PREVIOUS).beacon())));
        vm.setEnv("PACKS2_PREVIOUS_PROXY", vm.toString(PREVIOUS));
        owner = BasqitPacks2(PREVIOUS).owner();
    }

    function test_sharedAssetsPreserveSupplyAndUseExistingBalances() public {
        DeployPacks2SharedAssets deploy = new DeployPacks2SharedAssets();
        ISharedAssetFactory factory = ISharedAssetFactory(FACTORY);
        address payment = factory.usdG();
        address[] memory listed = factory.allowedTokens();
        address assetOwner = owner;
        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        vm.stopBroadcast();
        vm.prank(owner);
        BasqitPacks2(PREVIOUS).transferOwnership(broadcaster);
        vm.prank(broadcaster);
        BasqitPacks2(PREVIOUS).acceptOwnership();
        for (uint256 i; i < listed.length; i++) {
            if (TestnetToken(listed[i]).balanceOf(assetOwner) >= 100e18) {
                vm.prank(assetOwner);
                TestnetToken(listed[i]).transfer(broadcaster, 100e18);
            }
        }
        owner = broadcaster;
        uint256[] memory supply = new uint256[](listed.length);
        for (uint256 i; i < listed.length; i++) {
            supply[i] = TestnetToken(listed[i]).totalSupply();
        }
        BasqitPacks2 packs = deploy.run();
        assertNotEq(address(packs), PREVIOUS);
        assertEq(packs.owner(), owner);
        assertEq(address(packs.payToken()), payment);
        assertEq(address(packs.beacon()), address(BasqitPacks2(PREVIOUS).beacon()));
        assertEq(
            uint256(vm.load(address(packs), 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)),
            uint256(uint160(IMPLEMENTATION))
        );
        assertTrue(BasqitPacks2(PREVIOUS).opensPaused());
        assertEq(packs.openingCount(), 0);
        for (uint256 i; i < listed.length; i++) {
            assertEq(TestnetToken(listed[i]).totalSupply(), supply[i]);
        }
        ISharedAssetPrices prices = ISharedAssetPrices(factory.priceReference());
        uint16[5] memory ends = [uint16(657), 970, 989, 999, 1000];
        for (uint8 kind = 1; kind <= 3; kind++) {
            assertEq(packs.currentConfigId(kind), uint256(kind) + 9);
            BasqitPacks2.PackConfig memory config = packs.packConfig(packs.currentConfigId(kind));
            BasqitPacks2.StockOption[] memory pool = packs.stockPool(packs.currentConfigId(kind));
            assertEq(pool.length, 5);
            uint256 weighted;
            uint256 rounding;
            for (uint256 i; i < 5; i++) {
                assertTrue(factory.isAllowedToken(pool[i].token));
                assertEq(pool[i].referencePriceUsdG, prices.priceUsdG(pool[i].token));
                assertEq(TestnetToken(pool[i].token).balanceOf(address(packs)), 100e18);
                uint256 ref = pool[i].referencePriceUsdG;
                for (uint256 j; j < 5; j++) {
                    assertEq(config.tiers[j].end, ends[j]);
                    uint256 count = ends[j] - (j == 0 ? 0 : ends[j - 1]);
                    weighted += uint256(pool[i].amounts[j]) * ref * count;
                    rounding += ref * count;
                }
            }
            uint256 target = uint256(config.price) * 800 * 5 * 1e18;
            assertLe(weighted, target);
            assertLt(target - weighted, rounding);
        }
        vm.prank(assetOwner);
        TestnetToken(payment).mint(owner, 111e6);
        vm.startPrank(owner);
        TestnetToken(payment).approve(address(packs), 111e6);
        for (uint8 kind = 1; kind <= 3; kind++) {
            packs.openPack(kind, 1, packs.currentConfigId(kind));
        }
        vm.stopPrank();
        assertEq(TestnetToken(payment).balanceOf(address(packs)), 111e6);
        assertEq(packs.openingCount(), 3);
    }

    function test_rejectsUnrelatedFaucetAndNonTestnet() public {
        DeployPacks2SharedAssets deploy = new DeployPacks2SharedAssets();
        vm.setEnv("PACKS2_SHARED_FAUCET", "0xF047D3945145E2aDd8f1733FaB3484d81C55B853");
        vm.expectRevert("Wrong shared faucet");
        deploy.run();
        vm.chainId(4663);
        vm.expectRevert("Robinhood testnet only");
        deploy.run();
        vm.setEnv("PACKS2_SHARED_FAUCET", vm.toString(FAUCET));
    }
}
