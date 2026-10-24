// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";
import { MockDrandBeacon } from "../contracts/mocks/MockDrandBeacon.sol";

contract Packs2TransferToken is ERC20 {
    bool public blocked;
    bool public taxed;
    address public callback;
    bytes public callbackData;
    bool public reentryBlocked;

    constructor() ERC20("Transfer test", "TRANSFER") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(bool blocked_, bool taxed_) external {
        blocked = blocked_;
        taxed = taxed_;
    }

    function setCallback(address target, bytes calldata data) external {
        callback = target;
        callbackData = data;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) {
            require(!blocked, "Transfer blocked");
            if (callback != address(0)) {
                (bool ok, bytes memory result) = callback.call(callbackData);
                reentryBlocked = !ok && bytes4(result) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
            }
            if (taxed) {
                super._update(from, address(0), 1);
                amount--;
            }
        }
        super._update(from, to, amount);
    }
}

/// @dev Upgrade fixture reuses the initialized parent; only the new field needs a reinitializer.
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract Packs2V2TestImplementation is BasqitPacks2 {
    uint256 public upgradeMarker;

    function initializeV2(uint256 marker) external reinitializer(4) onlyOwner {
        upgradeMarker = marker;
    }
}

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract Packs2CatalogUpgradeFixture is BasqitPacks2 {
    function repointTestType() external onlyOwner {
        currentConfigId[1] = 3;
    }
}

contract Packs2Test is Test {
    BasqitPacks2 internal packs;
    BasqitPacks2 internal implementation;
    TestnetToken internal payment;
    TestnetToken internal stock;
    MockDrandBeacon internal beacon;
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(1_800_000_000);
        implementation = new BasqitPacks2();
        payment = new TestnetToken("Test Dollar", "tUSDG", 6, address(this));
        stock = new TestnetToken("Test Stock", "tSTOCK", 18, address(this));
        beacon = new MockDrandBeacon();
        packs = _deploy(address(this), address(payment), address(beacon), 100_000, _table());
        payment.mint(alice, 100e6);
        vm.prank(alice);
        payment.approve(address(packs), 100e6);
    }

    function _deploy(
        address owner_,
        address payment_,
        address beacon_,
        uint128 price_,
        BasqitPacks2.Tier[] memory table
    ) internal returns (BasqitPacks2) {
        return BasqitPacks2(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(BasqitPacks2.initialize, (owner_, payment_, beacon_, price_, table))
                )
            )
        );
    }

    function _table() internal view returns (BasqitPacks2.Tier[] memory table) {
        table = new BasqitPacks2.Tier[](2);
        table[0] = BasqitPacks2.Tier(address(stock), 1e18, 900);
        table[1] = BasqitPacks2.Tier(address(stock), 10e18, 1000);
    }

    function _open(uint16 count) internal returns (uint256 id) {
        vm.prank(alice);
        id = packs.open(count);
    }

    function _reveal(uint256 id, bytes32 value) internal {
        vm.warp(beacon.publishTime(packs.opening(id).round));
        vm.prank(keeper);
        packs.reveal(id, abi.encode(value));
    }

    function test_openChargesAndCommitsFutureRound() public {
        uint256 id = _open(5);
        BasqitPacks2.Opening memory o = packs.opening(id);
        assertEq(o.recipient, alice);
        assertEq(o.quantity, 5);
        assertGe(beacon.publishTime(o.round), block.timestamp + 30);
        assertEq(payment.balanceOf(address(packs)), 500_000);
        assertEq(packs.openingIds(alice, 0, 10)[0], id);
    }

    function _catalog() internal {
        packs.initializePackTypes(212_319_454);
        payment.mint(alice, 1_000_000e6);
        vm.prank(alice);
        payment.approve(address(packs), 1_000_000e6);
    }

    function _openType(uint8 packType, uint16 count) internal returns (uint256 id) {
        vm.prank(alice);
        return packs.openPack(packType, count, uint256(packType));
    }

    function test_catalogPricesAndExactPayments() public {
        _catalog();
        assertEq(packs.configCount(), 3);
        for (uint8 packType = 1; packType <= 3; packType++) {
            uint256 configId = packs.currentConfigId(packType);
            BasqitPacks2.PackConfig memory config = packs.packConfig(configId);
            assertEq(config.price, 1e6 * 10 ** (packType - 1));
            assertEq(config.referencePriceUsdG, 212_319_454);
            uint256 beforeBalance = payment.balanceOf(alice);
            uint256 id = _openType(packType, 3);
            assertEq(beforeBalance - payment.balanceOf(alice), uint256(config.price) * 3);
            assertEq(packs.openingConfigId(id), configId);
            assertEq(keccak256(abi.encode(packs.openingTerms(id))), keccak256(abi.encode(config)));
            _reveal(id, bytes32(uint256(123 + packType)));
            for (uint16 i; i < 3; i++) {
                (BasqitPacks2.Tier memory prize, uint16 slot,) = packs.outcome(id, i);
                uint256 tier;
                while (slot >= config.tiers[tier].end) tier++;
                assertEq(prize.amount, config.tiers[tier].amount);
                assertEq(prize.token, address(stock));
            }
        }
        vm.expectRevert(BasqitPacks2.UsePackType.selector);
        _open(1);
        assertEq(packs.price(), 100_000);
    }

    function testFuzz_catalogExpectedReturnAtEveryPrice(uint256 referencePrice) public {
        referencePrice = bound(referencePrice, 1e6, 1_000_000e6);
        packs.initializePackTypes(referencePrice);
        for (uint8 packType = 1; packType <= 3; packType++) {
            BasqitPacks2.PackConfig memory config = packs.packConfig(packs.currentConfigId(packType));
            uint256 weighted;
            uint16 previous;
            for (uint256 i; i < config.tiers.length; i++) {
                weighted += uint256(config.tiers[i].amount) * (config.tiers[i].end - previous);
                previous = config.tiers[i].end;
            }
            assertEq(previous, 1000);
            uint256 target = uint256(config.price) * 750 * 1e18;
            assertLe(weighted * referencePrice, target);
            assertLt(target - weighted * referencePrice, referencePrice * 1000);
        }
    }

    function test_catalogPreservesLegacyAndStarterTermsBeforeAndAfterReveal() public {
        uint256 legacyRevealed = _open(2);
        _reveal(legacyRevealed, bytes32(uint256(123)));
        BasqitPacks2.Payout[] memory original = packs.outcomes(legacyRevealed);
        stock.mint(address(packs), original[0].amount);
        packs.claim(legacyRevealed, 0);
        uint256 legacyPending = _open(1);
        packs.initializeStarter(200e6);
        uint256 starterPending = _open(2);
        bytes32 starterTerms = keccak256(abi.encode(packs.openingTerms(starterPending)));
        uint256 liability = packs.liabilities(address(stock));
        _catalog();
        assertEq(packs.liabilities(address(stock)), liability);
        assertEq(keccak256(abi.encode(packs.openingTerms(starterPending))), starterTerms);
        assertEq(packs.openingTerms(legacyPending).tiers[0].amount, 1e18);
        assertEq(packs.openingTerms(legacyPending).price, 100_000);
        assertEq(packs.openingTerms(legacyPending).referencePriceUsdG, 0);
        assertEq(packs.openingConfigId(legacyRevealed), 0);
        BasqitPacks2.Payout[] memory retained = packs.outcomes(legacyRevealed);
        for (uint256 i; i < retained.length; i++) {
            assertEq(retained[i].slot, original[i].slot);
            assertEq(retained[i].amount, original[i].amount);
        }
        assertTrue(retained[0].paid);
        _reveal(legacyPending, bytes32(uint256(456)));
        _reveal(starterPending, bytes32(uint256(789)));
        assertGe(packs.outcomes(legacyPending)[0].amount, 1e18);
        assertLt(packs.outcomes(starterPending)[0].amount, 1e18);
        uint256 newest = _openType(3, 1);
        _reveal(newest, bytes32(uint256(987)));
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(legacyRevealed);
        packs.claimAll(legacyPending);
        packs.claimAll(starterPending);
        packs.claimAll(newest);
        assertEq(packs.liabilities(address(stock)), 0);
    }

    function test_catalogPinsConfigurationWhenFutureUpgradeChangesSelection() public {
        _catalog();
        uint256 original = _openType(1, 1);
        bytes32 terms = keccak256(abi.encode(packs.openingTerms(original)));
        Packs2CatalogUpgradeFixture next = new Packs2CatalogUpgradeFixture();
        packs.upgradeToAndCall(address(next), abi.encodeCall(next.repointTestType, ()));
        uint256 beforeBalance = payment.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ConfigChanged.selector);
        packs.openPack(1, 1, 1);
        assertEq(payment.balanceOf(alice), beforeBalance);
        assertEq(packs.openingCount(), original);
        vm.prank(alice);
        uint256 changed = packs.openPack(1, 1, 3);
        assertEq(packs.openingTerms(changed).price, 100e6);
        _reveal(original, bytes32(uint256(123)));
        _reveal(changed, bytes32(uint256(456)));
        assertEq(packs.openingConfigId(original), 1);
        assertEq(keccak256(abi.encode(packs.openingTerms(original))), terms);
        assertEq(packs.openingTerms(original).price, 1e6);
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(original);
        packs.claimAll(changed);
        assertEq(packs.liabilities(address(stock)), 0);
    }

    function test_catalogValidationAndAccess() public {
        vm.expectRevert(BasqitPacks2.BadPackType.selector);
        _openType(1, 1);
        vm.prank(alice);
        vm.expectRevert();
        packs.initializePackTypes(200e6);
        vm.expectRevert();
        packs.initializePackTypes(0);
        assertEq(packs.configCount(), 0);
        _catalog();
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        packs.initializePackTypes(201e6);
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        implementation.initializePackTypes(200e6);
        vm.expectRevert(BasqitPacks2.BadPackType.selector);
        packs.packConfig(0);
        vm.expectRevert(BasqitPacks2.BadPackType.selector);
        _openType(4, 1);
        vm.expectRevert(BasqitPacks2.BadQuantity.selector);
        _openType(1, 0);
        vm.expectRevert(BasqitPacks2.BadQuantity.selector);
        _openType(3, 101);
        vm.expectRevert(BasqitPacks2.BadOpening.selector);
        packs.openingTerms(999);
        uint256 id = _openType(2, 1);
        packs.setOpensPaused(true);
        vm.expectRevert(BasqitPacks2.OpeningPaused.selector);
        _openType(3, 1);
        _reveal(id, bytes32(uint256(123)));
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(id);
    }

    function test_catalogCannotSpendUsingLowerPriceApproval() public {
        _catalog();
        vm.prank(alice);
        payment.approve(address(packs), 1e6);
        uint256 beforeBalance = payment.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        packs.openPack(2, 1, 2);
        assertEq(payment.balanceOf(alice), beforeBalance);
        assertEq(packs.openingCount(), 0);
        assertEq(payment.balanceOf(address(packs)), 0);
    }

    function test_catalogRejectsUnexpectedTokenDecimals() public {
        TestnetToken wrongDecimals = new TestnetToken("Wrong decimals", "WRONG", 18, address(this));
        packs = _deploy(address(this), address(wrongDecimals), address(beacon), 100_000, _table());
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializePackTypes(200e6);
        TestnetToken wrongStock = new TestnetToken("Wrong stock decimals", "WRONG", 6, address(this));
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](1);
        table[0] = BasqitPacks2.Tier(address(wrongStock), 1, 1000);
        packs = _deploy(address(this), address(payment), address(beacon), 100_000, table);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializePackTypes(200e6);
    }

    function testFuzz_catalogSharedVaultAndCollectionRetry(uint8 packType, uint16 count, bytes32 value) public {
        packType = uint8(bound(packType, 1, 3));
        count = uint16(bound(count, 1, 100));
        vm.assume(value != bytes32(0));
        _catalog();
        uint256 id = _openType(packType, count);
        _reveal(id, value);
        BasqitPacks2.Payout[] memory results = packs.outcomes(id);
        bytes32 seed = packs.opening(id).seed;
        vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
        uint256 total;
        for (uint256 i; i < results.length; i++) {
            total += results[i].amount;
        }
        stock.mint(address(packs), results[0].amount);
        packs.claim(id, 0);
        stock.mint(keeper, total - results[0].amount);
        vm.startPrank(keeper);
        if (total > results[0].amount) {
            stock.approve(address(packs), total - results[0].amount);
            packs.fund(address(stock), total - results[0].amount);
            packs.claimAll(id);
        }
        vm.stopPrank();
        assertEq(packs.opening(id).seed, seed);
        assertEq(packs.opening(id).claimed, (uint256(1) << count) - 1);
        assertEq(stock.balanceOf(alice), total);
        assertEq(packs.liabilities(address(stock)), 0);
    }

    function test_starterConfigurationPreservesOldRevealsAndPendingOpenings() public {
        uint256 revealed = _open(3);
        _reveal(revealed, bytes32(uint256(123)));
        BasqitPacks2.Payout[] memory beforePayouts = packs.outcomes(revealed);
        stock.mint(address(packs), beforePayouts[0].amount);
        packs.claim(revealed, 0);
        uint256 pending = _open(2);
        bytes32 seed = packs.opening(revealed).seed;
        uint256 liability = packs.liabilities(address(stock));
        packs.initializeStarter(200e6);
        assertEq(packs.starterFromOpening(), pending + 1);
        assertEq(packs.referencePriceUsdG(), 200e6);
        assertEq(packs.opening(revealed).seed, seed);
        assertEq(packs.liabilities(address(stock)), liability);
        BasqitPacks2.Payout[] memory afterPayouts = packs.outcomes(revealed);
        for (uint256 i; i < beforePayouts.length; i++) {
            assertEq(afterPayouts[i].amount, beforePayouts[i].amount);
            assertEq(afterPayouts[i].slot, beforePayouts[i].slot);
        }
        assertTrue(afterPayouts[0].paid);
        uint256 next = _open(10);
        _reveal(pending, bytes32(uint256(456)));
        _reveal(next, bytes32(uint256(789)));
        (BasqitPacks2.Tier memory oldPrize,,) = packs.outcome(pending, 0);
        assertGe(oldPrize.amount, 1e18);
        BasqitPacks2.Tier[] memory table = packs.tiers();
        for (uint16 i; i < 10; i++) {
            (BasqitPacks2.Tier memory prize, uint16 slot,) = packs.outcome(next, i);
            uint256 tier;
            while (slot >= table[tier].end) tier++;
            assertEq(prize.amount, table[tier].amount);
        }
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(revealed);
        packs.claimAll(pending);
        packs.claimAll(next);
        assertEq(packs.liabilities(address(stock)), 0);
    }

    function testFuzz_starterExpectedReturnIs75Percent(uint256 referencePrice) public {
        referencePrice = bound(referencePrice, 1e6, 1_000_000e6);
        packs.initializeStarter(referencePrice);
        BasqitPacks2.Tier[] memory table = packs.tiers();
        assertEq(table.length, 5);
        uint256 weighted;
        uint16 start;
        for (uint256 i; i < table.length; i++) {
            weighted += uint256(table[i].amount) * (table[i].end - start);
            start = table[i].end;
        }
        assertEq(start, 1000);
        uint256 target = uint256(packs.price()) * 750 * 1e18;
        assertLe(weighted * referencePrice, target);
        assertLt(target - weighted * referencePrice, referencePrice * 1000);
    }

    function test_starterConfigurationValidationAndAccess() public {
        vm.prank(alice);
        vm.expectRevert();
        packs.initializeStarter(200e6);
        vm.expectRevert();
        packs.initializeStarter(0);
        assertEq(packs.starterFromOpening(), 0);
        packs.initializeStarter(200e6);
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        packs.initializeStarter(201e6);
    }

    function test_proxyAndImplementationCannotBeReinitialized() public {
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        implementation.initialize(address(this), address(payment), address(beacon), 100_000, _table());
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        packs.initialize(alice, address(payment), address(beacon), 100_000, _table());
        assertEq(packs.owner(), address(this));
        vm.expectRevert(bytes4(keccak256("UUPSUnauthorizedCallContext()")));
        implementation.upgradeToAndCall(address(packs), "");
        vm.expectRevert(bytes4(keccak256("UUPSUnauthorizedCallContext()")));
        packs.proxiableUUID();
    }

    function test_upgradeRejectsUnauthorizedOrIncompatibleImplementations() public {
        BasqitPacks2 next = new BasqitPacks2();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), alice));
        packs.upgradeToAndCall(address(next), "");
        vm.expectRevert();
        packs.upgradeToAndCall(alice, "");
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("ERC1967InvalidImplementation(address)")), address(stock))
        );
        packs.upgradeToAndCall(address(stock), "");
        packs.transferOwnership(keeper);
        vm.prank(keeper);
        vm.expectRevert();
        packs.upgradeToAndCall(address(next), "");
        vm.prank(keeper);
        packs.acceptOwnership();
        vm.expectRevert();
        packs.upgradeToAndCall(address(next), "");
        vm.prank(keeper);
        packs.upgradeToAndCall(address(next), "");
        assertEq(packs.owner(), keeper);
    }

    function test_upgradePreservesPendingOpeningsClaimsAndBalances() public {
        uint256 revealed = _open(3);
        _reveal(revealed, bytes32(uint256(123)));
        (BasqitPacks2.Tier memory first,,) = packs.outcome(revealed, 0);
        stock.mint(address(packs), first.amount);
        packs.claim(revealed, 0);
        uint256 pending = _open(2);
        BasqitPacks2.Opening memory beforeOpening = packs.opening(revealed);
        BasqitPacks2.Opening memory beforePending = packs.opening(pending);
        bytes32 tableHash = keccak256(abi.encode(packs.tiers()));
        uint256 liability = packs.liabilities(address(stock));
        uint256 proceeds = payment.balanceOf(address(packs));
        packs.setOpensPaused(true);
        packs.transferOwnership(keeper);
        Packs2V2TestImplementation next = new Packs2V2TestImplementation();
        packs.upgradeToAndCall(address(next), abi.encodeCall(next.initializeV2, (42)));
        assertEq(Packs2V2TestImplementation(address(packs)).upgradeMarker(), 42);
        assertEq(
            address(
                uint160(
                    uint256(vm.load(address(packs), bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)))
                )
            ),
            address(next)
        );
        assertEq(packs.owner(), address(this));
        assertEq(packs.pendingOwner(), keeper);
        assertTrue(packs.opensPaused());
        assertEq(packs.openingCount(), 2);
        assertEq(address(packs.payToken()), address(payment));
        assertEq(address(packs.beacon()), address(beacon));
        assertEq(packs.price(), 100_000);
        assertEq(keccak256(abi.encode(packs.tiers())), tableHash);
        assertTrue(packs.isPrizeToken(address(stock)));
        assertEq(keccak256(abi.encode(packs.opening(revealed))), keccak256(abi.encode(beforeOpening)));
        assertEq(keccak256(abi.encode(packs.opening(pending))), keccak256(abi.encode(beforePending)));
        assertEq(packs.openingIds(alice, 0, 2)[0], pending);
        assertEq(packs.liabilities(address(stock)), liability);
        assertEq(payment.balanceOf(address(packs)), proceeds);
        _reveal(pending, bytes32(uint256(456)));
        uint256 unpaid = packs.liabilities(address(stock));
        stock.mint(keeper, unpaid);
        vm.startPrank(keeper);
        stock.approve(address(packs), unpaid);
        packs.fund(address(stock), unpaid);
        packs.claimAll(revealed);
        packs.claimAll(pending);
        vm.stopPrank();
        assertEq(stock.balanceOf(alice), first.amount + unpaid);
        assertEq(packs.liabilities(address(stock)), 0);
        assertEq(packs.opening(revealed).claimed, 7);
        assertEq(packs.opening(pending).claimed, 3);
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        Packs2V2TestImplementation(address(packs)).initializeV2(99);
    }

    function test_shortagePreservesOutcomeThenAnyoneCanFundAndPayRecipient() public {
        uint256 id = _open(1);
        _reveal(id, bytes32(uint256(123)));
        (BasqitPacks2.Tier memory prize, uint16 slot, bool paid) = packs.outcome(id, 0);
        bytes32 seed = packs.opening(id).seed;
        assertFalse(paid);
        assertEq(packs.liabilities(address(stock)), prize.amount);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks2.VaultShort.selector, address(stock), prize.amount, 0));
        packs.claim(id, 0);
        assertEq(packs.opening(id).seed, seed);
        assertEq(packs.opening(id).claimed, 0);
        stock.mint(keeper, prize.amount);
        vm.startPrank(keeper);
        stock.approve(address(packs), prize.amount);
        packs.fund(address(stock), prize.amount);
        packs.claim(id, 0);
        vm.stopPrank();
        (BasqitPacks2.Tier memory afterPrize, uint16 afterSlot, bool afterPaid) = packs.outcome(id, 0);
        assertEq(afterPrize.amount, prize.amount);
        assertEq(afterSlot, slot);
        assertTrue(afterPaid);
        assertEq(stock.balanceOf(alice), prize.amount);
        assertEq(stock.balanceOf(keeper), 0);
        assertEq(packs.liabilities(address(stock)), 0);
        vm.expectRevert(BasqitPacks2.AlreadyPaid.selector);
        packs.claim(id, 0);
    }

    function test_revealWithoutFundsCannotBeReplaced() public {
        uint256 id = _open(2);
        _reveal(id, bytes32(uint256(123)));
        bytes32 seed = packs.opening(id).seed;
        vm.expectRevert(BasqitPacks2.AlreadyRevealed.selector);
        packs.reveal(id, abi.encode(bytes32(uint256(999))));
        assertEq(packs.opening(id).seed, seed);
        assertTrue(packs.opening(id).revealed);
    }

    function test_pauseOnlyStopsNewOpenings() public {
        uint256 id = _open(1);
        packs.setOpensPaused(true);
        vm.expectRevert(BasqitPacks2.OpeningPaused.selector);
        _open(1);
        _reveal(id, bytes32(uint256(123)));
        (BasqitPacks2.Tier memory prize,,) = packs.outcome(id, 0);
        stock.mint(address(packs), prize.amount);
        packs.claim(id, 0);
    }

    function test_oneShortClaimDoesNotBlockOtherBoxes() public {
        uint256 id = _open(10);
        _reveal(id, bytes32(uint256(123)));
        (BasqitPacks2.Tier memory prize,,) = packs.outcome(id, 0);
        stock.mint(address(packs), prize.amount);
        packs.claim(id, 0);
        vm.expectPartialRevert(BasqitPacks2.VaultShort.selector);
        packs.claim(id, 1);
        (,, bool paid) = packs.outcome(id, 0);
        assertTrue(paid);
    }

    function testFuzz_collectAllSkipsPaidAndShortPayoutsThenRetries(bytes32 value, uint16 count, uint128 budget)
        public
    {
        vm.assume(value != bytes32(0));
        count = uint16(bound(count, 2, 100));
        uint256 id = _open(count);
        _reveal(id, value);
        BasqitPacks2.Payout[] memory results = packs.outcomes(id);
        stock.mint(address(packs), results[0].amount);
        packs.claim(id, 0);
        uint256 remaining = bound(budget, 0, 100e18);
        stock.mint(address(packs), remaining);
        uint256 expected = 1;
        uint256 collected = results[0].amount;
        uint256 total = collected;
        for (uint16 i = 1; i < count; i++) {
            total += results[i].amount;
            if (remaining < results[i].amount) continue;
            remaining -= results[i].amount;
            collected += results[i].amount;
            expected |= uint256(1) << i;
        }
        bytes32 seed = packs.opening(id).seed;
        vm.prank(keeper);
        if (expected == 1) vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
        assertEq(packs.opening(id).claimed, expected);
        assertEq(stock.balanceOf(alice), collected);
        assertEq(stock.balanceOf(keeper), 0);
        assertEq(packs.liabilities(address(stock)), total - collected);
        stock.mint(address(packs), total - collected);
        if (collected == total) vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
        assertEq(packs.opening(id).seed, seed);
        assertEq(packs.opening(id).claimed, (uint256(1) << count) - 1);
        assertEq(stock.balanceOf(alice), total);
        assertEq(packs.liabilities(address(stock)), 0);
        vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
    }

    function test_collectAllRequiresValidRevealedOpening() public {
        vm.expectRevert(BasqitPacks2.BadOpening.selector);
        packs.claimAll(999);
        uint256 id = _open(1);
        vm.expectRevert(BasqitPacks2.NotRevealed.selector);
        packs.claimAll(id);
    }

    function test_invalidOrEarlyRevealLeavesOpeningUnchanged() public {
        uint256 id = _open(1);
        vm.expectRevert(BasqitPacks2.RoundNotReady.selector);
        packs.reveal(id, "");
        vm.warp(beacon.publishTime(packs.opening(id).round));
        vm.expectRevert("Invalid signature");
        packs.reveal(id, "");
        assertFalse(packs.opening(id).revealed);
        assertEq(packs.liabilities(address(stock)), 0);
    }

    function test_reusesAlreadyProvenRound() public {
        uint256 id = _open(1);
        uint64 round = packs.opening(id).round;
        vm.warp(beacon.publishTime(round));
        beacon.prove(round, abi.encode(bytes32(uint256(456))));
        packs.reveal(id, "");
        assertTrue(packs.opening(id).revealed);
    }

    function test_rejectsAlreadyPublicTargetRound() public {
        uint64 round = beacon.roundAfter(block.timestamp + 30);
        beacon.prove(round, abi.encode(bytes32(uint256(456))));
        vm.expectRevert(BasqitPacks2.RoundAlreadyPublic.selector);
        _open(1);
    }

    function test_validationAndAccess() public {
        vm.expectRevert(BasqitPacks2.BadQuantity.selector);
        _open(0);
        vm.expectRevert(BasqitPacks2.BadQuantity.selector);
        _open(101);
        vm.expectRevert(BasqitPacks2.BadOpening.selector);
        packs.claim(999, 0);
        uint256 id = _open(1);
        vm.expectRevert(BasqitPacks2.NotRevealed.selector);
        packs.claim(id, 0);
        vm.prank(alice);
        vm.expectRevert();
        packs.setOpensPaused(true);
        vm.prank(alice);
        vm.expectRevert();
        packs.withdrawPayments(alice, 1);
        vm.expectRevert(BasqitPacks2.UnsupportedToken.selector);
        packs.fund(address(payment), 1);
        packs.withdrawPayments(address(this), 100_000);
        assertEq(payment.balanceOf(address(this)), 100_000);
    }

    function test_invalidTablesAndMainnetDeploymentRejected() public {
        BasqitPacks2.Tier[] memory table = _table();
        table[1].end = 999;
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        _deploy(address(this), address(payment), address(beacon), 1, table);
        table = _table();
        table[1].end = 900;
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        _deploy(address(this), address(payment), address(beacon), 1, table);
        table = _table();
        table[0].token = address(payment);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        _deploy(address(this), address(payment), address(beacon), 1, table);
        vm.chainId(4663);
        vm.expectRevert(BasqitPacks2.NotTestnet.selector);
        _deploy(address(this), address(payment), address(beacon), 1, _table());
    }

    function test_failedOrShortTokenTransferKeepsClaimPending() public {
        Packs2TransferToken token = new Packs2TransferToken();
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](1);
        table[0] = BasqitPacks2.Tier(address(token), 10e18, 1000);
        packs = _deploy(address(this), address(payment), address(beacon), 100_000, table);
        vm.prank(alice);
        payment.approve(address(packs), 100_000);
        uint256 id = _open(1);
        _reveal(id, bytes32(uint256(123)));
        token.mint(address(packs), 10e18);
        bytes32 seed = packs.opening(id).seed;
        token.configure(true, false);
        vm.expectRevert();
        packs.claimAll(id);
        token.configure(false, true);
        vm.expectRevert(BasqitPacks2.ShortTransfer.selector);
        packs.claimAll(id);
        assertEq(token.balanceOf(alice), 0);
        assertEq(packs.opening(id).claimed, 0);
        assertEq(packs.liabilities(address(token)), 10e18);
        token.configure(false, false);
        token.setCallback(address(packs), abi.encodeCall(packs.claimAll, (id)));
        packs.claimAll(id);
        assertTrue(token.reentryBlocked());
        assertEq(token.balanceOf(alice), 10e18);
        assertEq(packs.opening(id).seed, seed);
    }

    function test_shortPaymentAndFundingRollBack() public {
        Packs2TransferToken token = new Packs2TransferToken();
        BasqitPacks2 taxedPayment = _deploy(address(this), address(token), address(beacon), 100_000, _table());
        token.mint(alice, 1e18);
        vm.prank(alice);
        token.approve(address(taxedPayment), 100_000);
        token.configure(false, true);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ShortTransfer.selector);
        taxedPayment.open(1);
        assertEq(taxedPayment.openingCount(), 0);
        assertEq(token.balanceOf(address(taxedPayment)), 0);
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](1);
        table[0] = BasqitPacks2.Tier(address(token), 10, 1000);
        packs = _deploy(address(this), address(payment), address(beacon), 100_000, table);
        vm.prank(alice);
        token.approve(address(packs), 100);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ShortTransfer.selector);
        packs.fund(address(token), 100);
        assertEq(token.balanceOf(address(packs)), 0);
    }

    function test_outOfOrderRevealsKeepSeparateSeedsAndPagination() public {
        uint256 first = _open(1);
        uint256 second = _open(1);
        _reveal(second, bytes32(uint256(456)));
        _reveal(first, bytes32(uint256(456)));
        assertNotEq(packs.opening(first).seed, packs.opening(second).seed);
        assertEq(packs.openingIds(alice, 0, 1)[0], second);
        assertEq(packs.openingIds(alice, 1, 1)[0], first);
        assertEq(packs.openingIds(alice, 2, 1).length, 0);
        vm.expectRevert(BasqitPacks2.BadQuantity.selector);
        packs.openingIds(alice, 0, 51);
    }

    function testFuzz_batchAccountingIsIndependentOfClaimOrder(bytes32 value, uint16 count) public {
        vm.assume(value != bytes32(0));
        count = uint16(bound(count, 1, 100));
        uint256 id = _open(count);
        _reveal(id, value);
        BasqitPacks2.Payout[] memory results = packs.outcomes(id);
        assertEq(results.length, count);
        uint256 total;
        for (uint16 i; i < count; i++) {
            (BasqitPacks2.Tier memory t, uint16 slot,) = packs.outcome(id, i);
            assertLt(slot, 1000);
            assertEq(t.amount, slot < 900 ? 1e18 : 10e18);
            assertEq(results[i].amount, t.amount);
            assertEq(results[i].slot, slot);
            assertFalse(results[i].paid);
            total += t.amount;
        }
        assertEq(packs.liabilities(address(stock)), total);
        stock.mint(address(packs), total);
        for (uint16 i = count; i > 0; i--) {
            packs.claim(id, i - 1);
        }
        assertEq(stock.balanceOf(alice), total);
        assertEq(packs.liabilities(address(stock)), 0);
        assertEq(packs.opening(id).claimed, (uint256(1) << count) - 1);
    }

    function _mixedAssets() internal returns (address[5] memory tokens, uint256[5] memory references) {
        tokens[0] = address(stock);
        for (uint256 i = 1; i < 5; i++) {
            tokens[i] = address(new TestnetToken("Mixed stock", "tMIX", 18, address(this)));
        }
        references = [uint256(212_319_454), 349_112_514, 525_641_976, 248_400_000, 372_115_000];
    }

    function test_mixedCatalogKeepsPurchasedTermsAndCalibratesEveryPrice() public {
        _catalog();
        uint256 oldId = _openType(3, 2);
        bytes32 terms = keccak256(abi.encode(packs.openingTerms(oldId)));
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.upgradeToAndCall(
            address(new BasqitPacks2()), abi.encodeCall(BasqitPacks2.initializeMixedPackTypes, (tokens, references))
        );
        assertEq(packs.configCount(), 6);
        assertEq(keccak256(abi.encode(packs.openingTerms(oldId))), terms);
        for (uint8 kind = 1; kind <= 3; kind++) {
            uint256 configId = packs.currentConfigId(kind);
            assertEq(configId, uint256(kind) + 3);
            BasqitPacks2.PackConfig memory config = packs.packConfig(configId);
            uint256[5] memory recorded = packs.packReferencePrices(configId);
            uint256 weighted;
            uint256 roundingBound;
            uint16 previous;
            for (uint256 i; i < 5; i++) {
                assertEq(config.tiers[i].token, tokens[i]);
                assertEq(recorded[i], references[i]);
                assertTrue(packs.isPrizeToken(tokens[i]));
                uint256 slots = config.tiers[i].end - previous;
                weighted += uint256(config.tiers[i].amount) * references[i] * slots;
                roundingBound += references[i] * slots;
                previous = config.tiers[i].end;
            }
            assertEq(previous, 1000);
            uint256 target = uint256(config.price) * 750 * 1e18;
            assertLe(weighted, target);
            assertLt(target - weighted, roundingBound);
            vm.prank(alice);
            uint256 id = packs.openPack(kind, 5, configId);
            assertEq(packs.openingConfigId(id), configId);
        }
        _reveal(oldId, bytes32(uint256(999)));
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(oldId);
        assertTrue(packs.outcomes(oldId)[0].paid);
        assertTrue(packs.outcomes(oldId)[1].paid);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ConfigChanged.selector);
        packs.openPack(1, 1, 1);
    }

    function test_mixedCatalogValidationAndReplay() public {
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeMixedPackTypes(tokens, references);
        _catalog();
        vm.prank(alice);
        vm.expectRevert();
        packs.initializeMixedPackTypes(tokens, references);
        address valid = tokens[1];
        tokens[1] = tokens[0];
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeMixedPackTypes(tokens, references);
        tokens[1] = address(payment);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeMixedPackTypes(tokens, references);
        tokens[1] = address(new TestnetToken("Wrong decimals", "WRONG", 8, address(this)));
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeMixedPackTypes(tokens, references);
        tokens[1] = address(0);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeMixedPackTypes(tokens, references);
        tokens[1] = valid;
        references[4] = 0;
        vm.expectRevert();
        packs.initializeMixedPackTypes(tokens, references);
        assertEq(packs.configCount(), 3);
        assertFalse(packs.isPrizeToken(valid));
        references[4] = 372_115_000;
        packs.initializeMixedPackTypes(tokens, references);
        vm.expectRevert();
        packs.initializeMixedPackTypes(tokens, references);
        vm.expectRevert(BasqitPacks2.BadPackType.selector);
        packs.packReferencePrices(99);
    }

    function test_mixedClaimsTrackFundingAndLiabilitiesPerToken() public {
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        vm.prank(alice);
        uint256 id = packs.openPack(3, 100, 6);
        _reveal(id, bytes32(uint256(555)));
        BasqitPacks2.Payout[] memory beforeResults = packs.outcomes(id);
        uint256 kinds;
        for (uint256 i; i < 5; i++) {
            if (packs.liabilities(tokens[i]) != 0) kinds++;
        }
        assertGt(kinds, 1);
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(id);
        BasqitPacks2.Payout[] memory partlyPaid = packs.outcomes(id);
        for (uint256 i; i < 100; i++) {
            assertEq(partlyPaid[i].paid, partlyPaid[i].token == address(stock));
            assertEq(partlyPaid[i].slot, beforeResults[i].slot);
            assertEq(partlyPaid[i].amount, beforeResults[i].amount);
        }
        for (uint256 i = 1; i < 5; i++) {
            TestnetToken(tokens[i]).mint(address(packs), packs.liabilities(tokens[i]));
        }
        packs.claimAll(id);
        BasqitPacks2.Payout[] memory afterResults = packs.outcomes(id);
        for (uint256 i; i < 100; i++) {
            assertTrue(afterResults[i].paid);
        }
        for (uint256 i; i < 5; i++) {
            assertEq(packs.liabilities(tokens[i]), 0);
        }
        vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
    }

    function test_stockSelectionKeepsEarlierTermsAndSeparatesStockFromLevel() public {
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        vm.prank(alice);
        uint256 oldId = packs.openPack(1, 2, 4);
        bytes32 oldTerms = keccak256(abi.encode(packs.openingTerms(oldId)));
        packs.upgradeToAndCall(address(new BasqitPacks2()), abi.encodeCall(BasqitPacks2.initializeStockSelection, ()));
        assertEq(packs.configCount(), 9);
        assertEq(keccak256(abi.encode(packs.openingTerms(oldId))), oldTerms);
        assertEq(packs.stockPool(4).length, 0);
        for (uint8 kind = 1; kind <= 3; kind++) {
            uint256 configId = packs.currentConfigId(kind);
            assertEq(configId, uint256(kind) + 6);
            BasqitPacks2.StockOption[] memory pool = packs.stockPool(configId);
            BasqitPacks2.PackConfig memory config = packs.packConfig(configId);
            assertEq(pool.length, 5);
            uint256 weighted;
            uint256 roundingBound;
            for (uint256 stockIndex; stockIndex < 5; stockIndex++) {
                assertEq(pool[stockIndex].token, tokens[stockIndex]);
                assertEq(pool[stockIndex].referencePriceUsdG, references[stockIndex]);
                uint16 previous;
                for (uint256 level; level < 5; level++) {
                    assertGt(pool[stockIndex].amounts[level], 0);
                    uint256 slots = config.tiers[level].end - previous;
                    weighted += uint256(pool[stockIndex].amounts[level]) * references[stockIndex] * slots;
                    roundingBound += references[stockIndex] * slots;
                    previous = config.tiers[level].end;
                }
            }
            uint256 target = uint256(config.price) * 750 * 1e18 * 5;
            assertLe(weighted, target);
            assertLt(target - weighted, roundingBound);
            vm.prank(alice);
            uint256 id = packs.openPack(kind, 100, configId);
            _reveal(id, bytes32(uint256(999 + kind)));
            BasqitPacks2.Payout[] memory results = packs.outcomes(id);
            bool[5] memory commonStocks;
            for (uint16 j; j < 100; j++) {
                uint256 level;
                while (results[j].slot >= config.tiers[level].end) level++;
                uint256 stockIndex = uint256(keccak256(abi.encode(packs.opening(id).seed, j, bytes32("stock")))) % 5;
                assertEq(results[j].token, pool[stockIndex].token);
                assertEq(results[j].amount, pool[stockIndex].amounts[level]);
                if (level == 0) commonStocks[stockIndex] = true;
            }
            for (uint256 j; j < 5; j++) {
                assertTrue(commonStocks[j]);
            }
            for (uint256 j; j < 5; j++) {
                TestnetToken(tokens[j]).mint(address(packs), packs.liabilities(tokens[j]));
            }
            packs.claimAll(id);
            assertEq(packs.opening(id).claimed, (uint256(1) << 100) - 1);
        }
        _reveal(oldId, bytes32(uint256(888)));
        BasqitPacks2.Payout[] memory oldResults = packs.outcomes(oldId);
        for (uint256 j; j < 2; j++) {
            uint256 level;
            while (oldResults[j].slot >= packs.openingTerms(oldId).tiers[level].end) level++;
            assertEq(oldResults[j].token, tokens[level]);
        }
    }

    function test_stockSelectionValidationAndReplay() public {
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeStockSelection();
        _catalog();
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeStockSelection();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        vm.prank(alice);
        vm.expectRevert();
        packs.initializeStockSelection();
        packs.initializeStockSelection();
        vm.expectRevert();
        packs.initializeStockSelection();
        vm.expectRevert(BasqitPacks2.BadPackType.selector);
        packs.stockPool(99);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ConfigChanged.selector);
        packs.openPack(1, 1, 4);
    }

    function test_stockSelectionUnderfundedRetryKeepsActualStockAndAmount() public {
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        vm.prank(alice);
        uint256 id = packs.openPack(1, 100, 7);
        _reveal(id, bytes32(uint256(12345)));
        BasqitPacks2.Payout[] memory original = packs.outcomes(id);
        stock.mint(address(packs), packs.liabilities(address(stock)));
        packs.claimAll(id);
        BasqitPacks2.Payout[] memory partlyPaid = packs.outcomes(id);
        for (uint256 j; j < 100; j++) {
            assertEq(partlyPaid[j].paid, partlyPaid[j].token == address(stock));
            assertEq(partlyPaid[j].token, original[j].token);
            assertEq(partlyPaid[j].amount, original[j].amount);
            assertEq(partlyPaid[j].slot, original[j].slot);
        }
        for (uint256 j = 1; j < 5; j++) {
            TestnetToken(tokens[j]).mint(address(packs), packs.liabilities(tokens[j]));
        }
        packs.claimAll(id);
        for (uint256 j; j < 5; j++) {
            assertEq(packs.liabilities(tokens[j]), 0);
        }
        vm.expectRevert(BasqitPacks2.NothingToCollect.selector);
        packs.claimAll(id);
    }

    function testFuzz_revisedPayoutCalibrationAndMaximum(uint256 referenceInput) public {
        referenceInput = bound(referenceInput, 1e6, 1_000_000e6);
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        for (uint256 i; i < 5; i++) {
            references[i] = referenceInput + i * 1e6;
        }
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        packs.initializePayoutSchedule();
        uint16[5] memory ends = [uint16(700), 994, 997, 999, 1000];
        uint256[5] memory multiples = [uint256(5000), 12500, 20000, 70000, 125000];
        for (uint8 kind = 1; kind <= 3; kind++) {
            uint256 configId = packs.currentConfigId(kind);
            assertEq(configId, uint256(kind) + 9);
            BasqitPacks2.PackConfig memory config = packs.packConfig(configId);
            BasqitPacks2.StockOption[] memory pool = packs.stockPool(configId);
            assertEq(config.price, 1e6 * 10 ** (kind - 1));
            uint256 weighted;
            uint256 roundingBound;
            for (uint256 stockIndex; stockIndex < 5; stockIndex++) {
                assertEq(pool[stockIndex].token, tokens[stockIndex]);
                uint16 previous;
                for (uint256 level; level < 5; level++) {
                    assertEq(config.tiers[level].end, ends[level]);
                    uint256 expected =
                        uint256(config.price) * multiples[level] * 1e18 / (references[stockIndex] * 10000);
                    assertEq(pool[stockIndex].amounts[level], expected);
                    uint256 slots = ends[level] - previous;
                    weighted += expected * references[stockIndex] * slots;
                    roundingBound += references[stockIndex] * slots;
                    previous = ends[level];
                }
                assertLe(
                    uint256(pool[stockIndex].amounts[4]) * references[stockIndex], uint256(config.price) * 125 * 1e17
                );
            }
            uint256 target = uint256(config.price) * 750 * 1e18 * 5;
            assertLe(weighted, target);
            assertLt(target - weighted, roundingBound);
        }
    }

    function test_revisedSchedulePreservesRevealedAndPendingPurchases() public {
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        vm.prank(alice);
        uint256 revealed = packs.openPack(1, 10, 7);
        _reveal(revealed, bytes32(uint256(222)));
        BasqitPacks2.Payout[] memory results = packs.outcomes(revealed);
        TestnetToken(results[0].token).mint(address(packs), results[0].amount);
        packs.claim(revealed, 0);
        results = packs.outcomes(revealed);
        vm.prank(alice);
        uint256 pending = packs.openPack(1, 10, 7);
        bytes32 oldTerms = keccak256(abi.encode(packs.openingTerms(pending)));
        bytes32 oldPool = keccak256(abi.encode(packs.stockPool(7)));
        packs.upgradeToAndCall(address(new BasqitPacks2()), abi.encodeCall(BasqitPacks2.initializePayoutSchedule, ()));
        assertEq(keccak256(abi.encode(packs.outcomes(revealed))), keccak256(abi.encode(results)));
        assertEq(keccak256(abi.encode(packs.openingTerms(pending))), oldTerms);
        assertEq(keccak256(abi.encode(packs.stockPool(7))), oldPool);
        assertEq(packs.openingConfigId(pending), 7);
        _reveal(pending, bytes32(uint256(333)));
        vm.prank(alice);
        uint256 newest = packs.openPack(1, 100, 10);
        _reveal(newest, bytes32(uint256(444)));
        BasqitPacks2.Payout[] memory newResults = packs.outcomes(newest);
        BasqitPacks2.StockOption[] memory pool = packs.stockPool(10);
        for (uint256 j; j < newResults.length; j++) {
            uint256 level;
            while (newResults[j].slot >= packs.openingTerms(newest).tiers[level].end) level++;
            for (uint256 k; k < 5; k++) {
                if (newResults[j].token == pool[k].token) assertEq(newResults[j].amount, pool[k].amounts[level]);
            }
        }
        for (uint256 j; j < 5; j++) {
            TestnetToken(tokens[j]).mint(address(packs), packs.liabilities(tokens[j]));
        }
        packs.claimAll(revealed);
        packs.claimAll(pending);
        packs.claimAll(newest);
        for (uint256 j; j < 5; j++) {
            assertEq(packs.liabilities(tokens[j]), 0);
        }
    }

    function test_revisedScheduleValidationAndReplay() public {
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializePayoutSchedule();
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializePayoutSchedule();
        packs.initializeStockSelection();
        vm.prank(alice);
        vm.expectRevert();
        packs.initializePayoutSchedule();
        packs.initializePayoutSchedule();
        vm.expectRevert();
        packs.initializePayoutSchedule();
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ConfigChanged.selector);
        packs.openPack(1, 1, 7);
    }

    function testFuzz_eightyPercentPayoutCalibrationAndMaximum(uint256 referenceInput) public {
        referenceInput = bound(referenceInput, 1e6, 1_000_000e6);
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        for (uint256 i; i < 5; i++) {
            references[i] = referenceInput + i * 1e6;
        }
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        packs.initializePayoutSchedule();
        packs.initializeEightyPercentPayouts();
        uint16[5] memory ends = [uint16(657), 970, 989, 999, 1000];
        uint256[5] memory multiples = [uint256(5000), 12500, 17500, 35000, 120000];
        for (uint8 kind = 1; kind <= 3; kind++) {
            uint256 configId = packs.currentConfigId(kind);
            assertEq(configId, uint256(kind) + 12);
            BasqitPacks2.PackConfig memory config = packs.packConfig(configId);
            BasqitPacks2.StockOption[] memory pool = packs.stockPool(configId);
            assertEq(config.price, 1e6 * 10 ** (kind - 1));
            uint256 weighted;
            uint256 roundingBound;
            for (uint256 stockIndex; stockIndex < 5; stockIndex++) {
                assertEq(pool[stockIndex].token, tokens[stockIndex]);
                uint16 previous;
                for (uint256 level; level < 5; level++) {
                    assertEq(config.tiers[level].end, ends[level]);
                    uint256 expected =
                        uint256(config.price) * multiples[level] * 1e18 / (references[stockIndex] * 10000);
                    assertEq(pool[stockIndex].amounts[level], expected);
                    uint256 slots = ends[level] - previous;
                    weighted += expected * references[stockIndex] * slots;
                    roundingBound += references[stockIndex] * slots;
                    previous = ends[level];
                }
                assertLe(
                    uint256(pool[stockIndex].amounts[4]) * references[stockIndex], uint256(config.price) * 12 * 1e18
                );
            }
            uint256 target = uint256(config.price) * 800 * 1e18 * 5;
            assertLe(weighted, target);
            assertLt(target - weighted, roundingBound);
        }
    }

    function test_eightyPercentSchedulePreservesRevealedAndPendingPurchases() public {
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        packs.initializePayoutSchedule();
        vm.prank(alice);
        uint256 revealed = packs.openPack(1, 10, 10);
        _reveal(revealed, bytes32(uint256(222)));
        BasqitPacks2.Payout[] memory results = packs.outcomes(revealed);
        TestnetToken(results[0].token).mint(address(packs), results[0].amount);
        packs.claim(revealed, 0);
        results = packs.outcomes(revealed);
        vm.prank(alice);
        uint256 pending = packs.openPack(1, 10, 10);
        bytes32 oldTerms = keccak256(abi.encode(packs.openingTerms(pending)));
        bytes32 oldPool = keccak256(abi.encode(packs.stockPool(10)));
        packs.upgradeToAndCall(
            address(new BasqitPacks2()), abi.encodeCall(BasqitPacks2.initializeEightyPercentPayouts, ())
        );
        assertEq(keccak256(abi.encode(packs.outcomes(revealed))), keccak256(abi.encode(results)));
        assertEq(keccak256(abi.encode(packs.openingTerms(pending))), oldTerms);
        assertEq(keccak256(abi.encode(packs.stockPool(10))), oldPool);
        assertEq(packs.openingConfigId(pending), 10);
        _reveal(pending, bytes32(uint256(333)));
        vm.prank(alice);
        uint256 newest = packs.openPack(1, 100, 13);
        _reveal(newest, bytes32(uint256(444)));
        BasqitPacks2.Payout[] memory newResults = packs.outcomes(newest);
        BasqitPacks2.StockOption[] memory pool = packs.stockPool(13);
        for (uint256 j; j < newResults.length; j++) {
            uint256 level;
            while (newResults[j].slot >= packs.openingTerms(newest).tiers[level].end) level++;
            for (uint256 k; k < 5; k++) {
                if (newResults[j].token == pool[k].token) assertEq(newResults[j].amount, pool[k].amounts[level]);
            }
        }
        for (uint256 j; j < 5; j++) {
            TestnetToken(tokens[j]).mint(address(packs), packs.liabilities(tokens[j]));
        }
        packs.claimAll(revealed);
        packs.claimAll(pending);
        packs.claimAll(newest);
        for (uint256 j; j < 5; j++) {
            assertEq(packs.liabilities(tokens[j]), 0);
        }
    }

    function test_eightyPercentScheduleValidationAndReplay() public {
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeEightyPercentPayouts();
        _catalog();
        (address[5] memory tokens, uint256[5] memory references) = _mixedAssets();
        packs.initializeMixedPackTypes(tokens, references);
        vm.expectRevert(BasqitPacks2.BadConfig.selector);
        packs.initializeEightyPercentPayouts();
        packs.initializeStockSelection();
        packs.initializePayoutSchedule();
        vm.prank(alice);
        vm.expectRevert();
        packs.initializeEightyPercentPayouts();
        packs.initializeEightyPercentPayouts();
        vm.expectRevert();
        packs.initializeEightyPercentPayouts();
        vm.prank(alice);
        vm.expectRevert(BasqitPacks2.ConfigChanged.selector);
        packs.openPack(1, 1, 10);
    }
}
