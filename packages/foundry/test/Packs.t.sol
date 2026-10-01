// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { BasqitPacks } from "../contracts/packs/BasqitPacks.sol";
import { BasqitGifts } from "../contracts/packs/BasqitGifts.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";
import { MockDiceEntropy } from "../contracts/mocks/MockDiceEntropy.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";
import { BasqitGiftRouter } from "../contracts/packs/BasqitGiftRouter.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitRouterBase } from "../contracts/BasqitRouterBase.sol";

/// A Stock Token stand-in the issuer can pause, to prove one paused item never holds back a pack.
contract PausableStock is MockStockToken {
    bool public paused;

    constructor() MockStockToken("Pausable", "PAUSE") { }

    function setPaused(bool value) external {
        paused = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "paused");
        super._update(from, to, value);
    }
}

contract PacksTest is Test {
    BasqitPacks packs;
    MockDiceEntropy dice;
    MockUSDG usdg;
    MockStockToken nvda;
    MockStockToken aapl;
    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant PRICE = 1e6;
    uint64 constant SALE = 1 days;
    uint64 constant DRAW = 1 hours;

    function setUp() public {
        dice = new MockDiceEntropy();
        packs = new BasqitPacks(owner, address(dice));
        usdg = new MockUSDG();
        nvda = new MockStockToken("Mock NVDA", "NVDA");
        aapl = new MockStockToken("Mock AAPL", "AAPL");
        nvda.mint(owner, 1000e18);
        aapl.mint(owner, 1000e18);
        nvda.approve(address(packs), type(uint256).max);
        aapl.approve(address(packs), type(uint256).max);
        for (uint256 i = 0; i < 3; i++) {
            address buyer = [alice, bob, makeAddr("carol")][i];
            usdg.mint(buyer, 1000e6);
            vm.prank(buyer);
            usdg.approve(address(packs), type(uint256).max);
        }
        vm.deal(alice, 1 ether);
    }

    /// Prize slot i is worth (i + 1) units of NVDA, except slot 0 which is 5 AAPL: easy to tell apart.
    function _prizes(uint256 size) internal view returns (BasqitPacks.Prize[] memory prizes) {
        prizes = new BasqitPacks.Prize[](size);
        prizes[0] = BasqitPacks.Prize(address(aapl), 5e18);
        for (uint256 i = 1; i < size; i++) {
            prizes[i] = BasqitPacks.Prize(address(nvda), (i + 1) * 1e17);
        }
    }

    /// Sets a template for `size` packs, funds exactly one round of prizes and starts it.
    function _open(uint256 size) internal returns (uint256 roundId) {
        packs.setTemplate(address(usdg), PRICE, _prizes(size), SALE, DRAW);
        packs.fundReserve(address(aapl), 5e18);
        packs.fundReserve(address(nvda), _nvdaTotal(size));
        roundId = packs.startNextRound();
    }

    function _sellOut(uint256 roundId, uint256 size) internal {
        vm.prank(alice);
        packs.buy(roundId, size / 2, alice);
        vm.prank(bob);
        packs.buy(roundId, size - size / 2, bob);
    }

    function _draw(uint256 roundId) internal returns (uint64 sequence) {
        uint256 fee = packs.drawFee();
        vm.prank(alice);
        packs.requestDraw{ value: fee }(roundId);
        sequence = packs.getRound(roundId).sequence;
    }

    function test_FullRoundAssignsEveryPrizeExactlyOnce() public {
        uint256 size = 10;
        uint256 roundId = _open(size);
        assertEq(nvda.balanceOf(address(packs)) + aapl.balanceOf(address(packs)), 5e18 + _nvdaTotal(size));
        _sellOut(roundId, size);
        assertEq(uint8(packs.getRound(roundId).status), uint8(BasqitPacks.Status.SoldOut));

        uint64 sequence = _draw(roundId);
        dice.reveal(sequence, keccak256("reveal"));
        assertEq(uint8(packs.getRound(roundId).status), uint8(BasqitPacks.Status.Seeded));
        packs.finalize(roundId);

        bytes memory order = packs.assignmentOf(roundId);
        bool[] memory seen = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 slot = uint8(order[i]);
            assertFalse(seen[slot], "slot assigned twice");
            seen[slot] = true;
            packs.claim(roundId, i); // anyone may claim; the recipient is the pack owner
        }
        assertEq(nvda.balanceOf(address(packs)), 0);
        assertEq(aapl.balanceOf(address(packs)), 0);
        assertEq(
            nvda.balanceOf(alice) + nvda.balanceOf(bob) + aapl.balanceOf(alice) + aapl.balanceOf(bob),
            5e18 + _nvdaTotal(size)
        );

        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.AlreadySettled.selector, 0));
        packs.claim(roundId, 0);

        packs.withdrawProceeds(roundId, owner);
        assertEq(usdg.balanceOf(owner), PRICE * size);
        assertEq(usdg.balanceOf(address(packs)), 0);
    }

    function test_AssignmentIsRecomputableFromSeed() public {
        uint256 roundId = _open(12);
        _sellOut(roundId, 12);
        dice.reveal(_draw(roundId), bytes32(uint256(42)));
        packs.finalize(roundId);
        bytes32 seed = packs.getRound(roundId).seed;
        assertEq(seed, keccak256(abi.encode(bytes32(uint256(42)), block.chainid, address(packs), roundId)));
        assertEq(packs.assignmentOf(roundId), packs.shuffle(seed, 12));
    }

    function testFuzz_ShuffleIsAPermutation(bytes32 seed, uint8 rawSize) public view {
        uint256 size = bound(rawSize, 1, 100);
        bytes memory order = packs.shuffle(seed, size);
        assertEq(order.length, size);
        bool[] memory seen = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 slot = uint8(order[i]);
            assertLt(slot, size);
            assertFalse(seen[slot]);
            seen[slot] = true;
        }
    }

    function test_TemplateChecksSizeAndOwner() public {
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.BadRoundSize.selector, 0));
        packs.setTemplate(address(usdg), PRICE, new BasqitPacks.Prize[](0), SALE, DRAW);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.BadRoundSize.selector, 101));
        packs.setTemplate(address(usdg), PRICE, new BasqitPacks.Prize[](101), SALE, DRAW);
        vm.prank(alice);
        vm.expectRevert();
        packs.setTemplate(address(usdg), PRICE, _prizes(2), SALE, DRAW);
    }

    function test_BuyLimitsAndDeadline() public {
        uint256 roundId = _open(4);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.NotEnoughPacks.selector, 4));
        packs.buy(roundId, 5, alice);
        vm.prank(alice);
        packs.buy(roundId, 3, bob);
        assertEq(packs.ownersOf(roundId)[2], bob);
        vm.warp(block.timestamp + SALE + 1);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks.SaleClosed.selector);
        packs.buy(roundId, 1, alice);
    }

    function test_DrawNeedsSoldOutAndExactFee() public {
        uint256 roundId = _open(2);
        uint256 fee = packs.drawFee();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.WrongStatus.selector, BasqitPacks.Status.Selling));
        packs.requestDraw{ value: fee }(roundId);
        _sellOut(roundId, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.WrongFee.selector, fee + 1, fee));
        packs.requestDraw{ value: fee + 1 }(roundId);
        _draw(roundId);
        // One request per round: no second draw.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.WrongStatus.selector, BasqitPacks.Status.Drawing));
        packs.requestDraw{ value: fee }(roundId);
    }

    function test_OnlyDiceCanCallBack() public {
        address provider = dice.PROVIDER();
        vm.expectRevert(BasqitPacks.OnlyEntropy.selector);
        packs._entropyCallback(1, provider, bytes32(0));
    }

    function test_UnsoldRoundCancelsAndRefunds() public {
        uint256 roundId = _open(4);
        vm.prank(alice);
        packs.buy(roundId, 3, alice);
        vm.expectRevert(BasqitPacks.NotCancellable.selector);
        packs.cancel(roundId);
        vm.warp(block.timestamp + SALE + 1);
        packs.cancel(roundId);
        for (uint256 i = 0; i < 3; i++) {
            packs.refund(roundId, i);
        }
        assertEq(usdg.balanceOf(alice), 1000e6);
        assertEq(packs.reserve(address(nvda)), _nvdaTotal(4), "prizes back in the reserve");
        uint256 nvdaBefore = nvda.balanceOf(owner);
        packs.withdrawReserve(address(nvda), _nvdaTotal(4), owner);
        assertEq(nvda.balanceOf(owner) - nvdaBefore, _nvdaTotal(4));
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.WrongStatus.selector, BasqitPacks.Status.Cancelled));
        packs.withdrawProceeds(roundId, owner);
    }

    function test_WithheldRevealCancelsRefundsFeeAndIgnoresLateReveal() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        uint256 aliceEth = alice.balance;
        uint64 sequence = _draw(roundId);
        vm.warp(block.timestamp + DRAW + 1);
        packs.cancel(roundId);

        packs.refundDiceFee(roundId);
        assertEq(alice.balance, aliceEth, "fee back to whoever paid it");
        vm.expectRevert(BasqitPacks.NoFeeToRefund.selector);
        packs.refundDiceFee(roundId);

        packs.refund(roundId, 0);
        packs.refund(roundId, 1);
        assertEq(usdg.balanceOf(address(packs)), 0);
        // Dice already refunded the request, so a late reveal is impossible; the callback path is still guarded.
        vm.expectRevert(MockDiceEntropy.NotOpen.selector);
        dice.reveal(sequence, bytes32(uint256(1)));
    }

    function test_LateRevealAfterCancelChangesNothing() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        uint64 sequence = _draw(roundId);
        vm.warp(block.timestamp + DRAW + 1);
        packs.cancel(roundId);
        dice.reveal(sequence, bytes32(uint256(7)));
        assertEq(uint8(packs.getRound(roundId).status), uint8(BasqitPacks.Status.Cancelled));
        assertEq(packs.getRound(roundId).seed, bytes32(0));
    }

    function test_SoldOutButNeverDrawnCancelsAfterTimeout() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        vm.expectRevert(BasqitPacks.NotCancellable.selector);
        packs.cancel(roundId);
        vm.warp(block.timestamp + DRAW + 1);
        packs.cancel(roundId);
        vm.expectRevert(BasqitPacks.NoFeeToRefund.selector);
        packs.refundDiceFee(roundId);
    }

    function test_SeededRoundCannotBeCancelled() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        dice.reveal(_draw(roundId), bytes32(uint256(3)));
        vm.warp(block.timestamp + DRAW + SALE + 1);
        vm.expectRevert(BasqitPacks.NotCancellable.selector);
        packs.cancel(roundId);
    }

    function test_OnlyOwnerTakesProceeds() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        dice.reveal(_draw(roundId), bytes32(uint256(9)));
        packs.finalize(roundId);
        vm.prank(alice);
        vm.expectRevert();
        packs.withdrawProceeds(roundId, alice);
    }

    function test_ClaimAllAndRefundAllTakeOnlyTheCallersPacks() public {
        uint256 roundId = _open(4);
        _sellOut(roundId, 4); // alice packs 0-1, bob packs 2-3
        dice.reveal(_draw(roundId), bytes32(uint256(11)));
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.WrongStatus.selector, BasqitPacks.Status.Seeded));
        vm.prank(alice);
        packs.claimAll(roundId);
        packs.finalize(roundId);
        packs.claim(roundId, 1); // one of alice's packs claimed on her behalf first
        vm.prank(alice);
        assertEq(packs.claimAll(roundId), 1, "only the unclaimed one");
        assertTrue(packs.settled(roundId, 0) && !packs.settled(roundId, 2), "bob's packs untouched");
        vm.prank(alice);
        vm.expectRevert(BasqitPacks.NothingToSettle.selector);
        packs.claimAll(roundId);
        vm.prank(bob);
        assertEq(packs.claimAll(roundId), 2);
        assertEq(nvda.balanceOf(address(packs)) + aapl.balanceOf(address(packs)), 0, "every prize paid");

        packs.clearTemplate();
        uint256 unsold = _open(3);
        vm.prank(alice);
        packs.buy(unsold, 2, alice);
        vm.warp(block.timestamp + SALE + 1);
        packs.cancel(unsold);
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        assertEq(packs.refundAll(unsold), 2);
        assertEq(usdg.balanceOf(alice) - before, 2 * PRICE);
    }

    function test_RenounceDisabled() public {
        vm.expectRevert(BasqitPacks.RenounceDisabled.selector);
        packs.renounceOwnership();
    }

    function _template(uint256 size) internal {
        packs.setTemplate(address(usdg), PRICE, _prizes(size), SALE, DRAW);
        packs.fundReserve(address(aapl), 5e18 * 3);
        packs.fundReserve(address(nvda), _nvdaTotal(size) * 3);
    }

    function test_AnyoneStartsTheNextRoundOnceTheLastIsDone() public {
        _template(4);
        vm.prank(bob);
        uint256 first = packs.startNextRound();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.RoundInProgress.selector, first));
        packs.startNextRound();

        _sellOut(first, 4);
        dice.reveal(_draw(first), bytes32(uint256(21)));
        packs.finalize(first);
        vm.prank(bob);
        uint256 second = packs.startNextRound();
        assertEq(second, first + 1);
        assertEq(packs.prizesOf(second).length, 4);

        // A cancelled round frees the way and puts its prizes back in the reserve.
        uint256 reserveBefore = packs.reserve(address(aapl));
        vm.warp(block.timestamp + SALE + 1);
        packs.cancel(second);
        assertEq(packs.reserve(address(aapl)), reserveBefore + 5e18, "cancelled prizes back in reserve");
        vm.prank(alice);
        packs.startNextRound();
        assertEq(packs.reserve(address(aapl)), 5e18, "one round of reserve left");
    }

    function test_WithheldTemplateRoundSwitchesTemplateOff() public {
        _template(2);
        uint256 roundId = packs.startNextRound();
        _sellOut(roundId, 2);
        _draw(roundId);
        vm.warp(block.timestamp + DRAW + 1);
        packs.cancel(roundId);
        assertEq(packs.templatePrizes().length, 0, "template off");
        assertEq(packs.reserve(address(nvda)), _nvdaTotal(2) * 3, "prizes back in reserve");
        vm.expectRevert(BasqitPacks.NoTemplate.selector);
        packs.startNextRound();
    }

    function test_OwnerChangesDrawTimeoutForFutureRounds() public {
        _template(2);
        uint256 first = packs.startNextRound();
        uint64 maxDraw = packs.MAX_DRAW_TIMEOUT();
        vm.prank(alice);
        vm.expectRevert();
        packs.setDrawTimeout(4 hours);
        vm.expectRevert(BasqitPacks.BadDuration.selector);
        packs.setDrawTimeout(maxDraw + 1);
        packs.setDrawTimeout(4 hours);
        assertEq(packs.getRound(first).drawTimeout, DRAW, "open round keeps its timeout");
        vm.warp(block.timestamp + SALE + 1);
        packs.cancel(first);
        assertEq(packs.getRound(packs.startNextRound()).drawTimeout, 4 hours, "next round uses the new one");
    }

    function test_ClearTemplateStopsNewRounds() public {
        _template(2);
        vm.prank(alice);
        vm.expectRevert();
        packs.clearTemplate();
        packs.clearTemplate();
        vm.expectRevert(BasqitPacks.NoTemplate.selector);
        packs.startNextRound();
        packs.withdrawReserve(address(nvda), packs.reserve(address(nvda)), owner);
    }

    function test_ReserveIsSeparateFromRoundEscrow() public {
        _template(2);
        packs.startNextRound();
        uint256 reserved = packs.reserve(address(nvda));
        vm.expectRevert(
            abi.encodeWithSelector(BasqitPacks.InsufficientReserve.selector, address(nvda), reserved + 1, reserved)
        );
        packs.withdrawReserve(address(nvda), reserved + 1, owner);
        packs.withdrawReserve(address(nvda), reserved, owner);
        assertEq(nvda.balanceOf(address(packs)), _nvdaTotal(2), "the running round keeps its prizes");
        vm.prank(alice);
        vm.expectRevert();
        packs.fundReserve(address(nvda), 1);
    }

    function test_NoTemplateNoRound() public {
        vm.expectRevert(BasqitPacks.NoTemplate.selector);
        packs.startNextRound();
    }

    function test_DurationBounds() public {
        uint64 min = packs.MIN_DRAW_TIMEOUT();
        uint64 maxDraw = packs.MAX_DRAW_TIMEOUT();
        uint64 maxSale = packs.MAX_SALE_DURATION();
        BasqitPacks.Prize[] memory prizes = _prizes(2);
        vm.expectRevert(BasqitPacks.BadDuration.selector);
        packs.setTemplate(address(usdg), PRICE, prizes, SALE, min - 1);
        vm.expectRevert(BasqitPacks.BadDuration.selector);
        packs.setTemplate(address(usdg), PRICE, prizes, SALE, maxDraw + 1);
        vm.expectRevert(BasqitPacks.BadDuration.selector);
        packs.setTemplate(address(usdg), PRICE, prizes, maxSale + 1, DRAW);
        vm.expectRevert(BasqitPacks.PriceTooHigh.selector);
        packs.setTemplate(address(usdg), type(uint256).max / 50, prizes, SALE, DRAW);
    }

    function test_RevealAfterTimeoutIsIgnoredEvenBeforeCancel() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        uint64 sequence = _draw(roundId);
        vm.warp(block.timestamp + DRAW + 1);
        dice.reveal(sequence, bytes32(uint256(5)));
        assertEq(uint8(packs.getRound(roundId).status), uint8(BasqitPacks.Status.Drawing));
        packs.cancel(roundId);
    }

    function test_ExpiredSoldOutRoundCannotStartADraw() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        vm.warp(block.timestamp + DRAW + 1);
        uint256 fee = packs.drawFee();
        vm.prank(alice);
        vm.expectRevert(BasqitPacks.SaleClosed.selector);
        packs.requestDraw{ value: fee }(roundId);
    }

    function test_OnlyPackOwnerRedirectsPrizeOrRefund() public {
        uint256 roundId = _open(2);
        _sellOut(roundId, 2);
        dice.reveal(_draw(roundId), bytes32(uint256(11)));
        packs.finalize(roundId);
        address cold = makeAddr("cold");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasqitPacks.NotPackOwner.selector, 0));
        packs.claimTo(roundId, 0, bob);
        vm.prank(alice);
        packs.claimTo(roundId, 0, cold);
        assertGt(nvda.balanceOf(cold) + aapl.balanceOf(cold), 0);
    }

    function test_CannotBuyForThePacksContract() public {
        uint256 roundId = _open(2);
        vm.prank(alice);
        vm.expectRevert(BasqitPacks.ZeroAddress.selector);
        packs.buy(roundId, 1, address(packs));
    }

    function _nvdaTotal(uint256 size) internal pure returns (uint256 total) {
        for (uint256 i = 1; i < size; i++) {
            total += (i + 1) * 1e17;
        }
    }
}

contract GiftsTest is Test {
    BasqitGifts gifts;
    BasqitGiftRouter router;
    TestnetSwapAdapter shop;
    BasqitFactory factory;
    MockUSDG usdg;
    MockStockToken nvda;
    MockStockToken aapl;
    address owner = address(this);
    address alice = makeAddr("alice");
    address friend = makeAddr("friend");
    address treasury = makeAddr("treasury");

    function setUp() public {
        usdg = new MockUSDG();
        nvda = new MockStockToken("Mock NVDA", "NVDA");
        aapl = new MockStockToken("Mock AAPL", "AAPL");
        address[] memory listed = new address[](2);
        listed[0] = address(nvda);
        listed[1] = address(aapl);
        factory = new BasqitFactory(owner, address(usdg), listed, address(0));
        gifts = new BasqitGifts(owner, address(factory));
        shop = new TestnetSwapAdapter(address(usdg), owner);
        shop.setPrice(address(nvda), 200e6); // $200 per NVDA
        shop.setPrice(address(aapl), 300e6);
        nvda.mint(address(shop), 10e18);
        aapl.mint(address(shop), 10e18);
        address[] memory adapters = new address[](1);
        adapters[0] = address(shop);
        router = new BasqitGiftRouter(address(usdg), address(factory), address(gifts), owner, adapters);
        usdg.mint(alice, 1000e6);
        nvda.mint(alice, 1e18);
        vm.startPrank(alice);
        usdg.approve(address(router), type(uint256).max);
        nvda.approve(address(gifts), type(uint256).max);
        vm.stopPrank();
    }

    function _one(address token, uint256 amount) internal pure returns (BasqitGifts.Item[] memory items) {
        items = new BasqitGifts.Item[](1);
        items[0] = BasqitGifts.Item(token, amount);
    }

    /// 0.1 NVDA ($20) + 0.2 AAPL ($60), each leg capped at $100.
    function _purchases() internal view returns (BasqitGiftRouter.Purchase[] memory p) {
        p = new BasqitGiftRouter.Purchase[](2);
        p[0] = BasqitGiftRouter.Purchase(address(nvda), 1e17, address(shop), 100e6, "");
        p[1] = BasqitGiftRouter.Purchase(address(aapl), 2e17, address(shop), 100e6, "");
    }

    function test_WrapWhatYouHoldForAFriend() public {
        vm.prank(alice);
        uint256 giftId = gifts.wrap(_one(address(nvda), 3e17), friend);
        assertEq(gifts.ownerOf(giftId), friend);
        assertEq(nvda.balanceOf(alice), 7e17);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.NotHolder.selector, giftId));
        gifts.open(giftId);
        vm.prank(friend);
        gifts.open(giftId);
        assertEq(nvda.balanceOf(friend), 3e17);
        vm.expectRevert();
        gifts.contentsOf(giftId);
    }

    function test_WrapChecks() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.NotListed.selector, address(usdg)));
        gifts.wrap(_one(address(usdg), 1), friend);
        BasqitGifts.Item[] memory dup = new BasqitGifts.Item[](2);
        dup[0] = BasqitGifts.Item(address(nvda), 1);
        dup[1] = BasqitGifts.Item(address(nvda), 1);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.DuplicateToken.selector, address(nvda)));
        gifts.wrap(dup, friend);
        vm.expectRevert(BasqitGifts.ZeroAmount.selector);
        gifts.wrap(_one(address(nvda), 0), friend);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.BadItems.selector, 11));
        gifts.wrap(new BasqitGifts.Item[](11), friend);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.InvalidRecipient.selector, address(gifts)));
        gifts.wrap(_one(address(nvda), 1), address(gifts));
        vm.stopPrank();
        assertEq(address(gifts.stockTokens()), address(factory), "one token list for baskets and gifts");
    }

    function test_RouterBuysAndSealsAGift() public {
        vm.prank(alice);
        (uint256 giftId, uint256 spent, uint256 fee, uint256 refunded) =
            router.buyGift(_purchases(), 100e6, 500, address(gifts), friend, block.timestamp);
        assertEq(spent, 80e6);
        assertEq(fee, 0);
        assertEq(refunded, 20e6);
        assertEq(usdg.balanceOf(alice), 920e6);
        assertEq(gifts.ownerOf(giftId), friend);
        assertEq(gifts.contentsOf(giftId).length, 2);
        assertEq(nvda.balanceOf(address(router)), 0, "router keeps nothing");
        assertEq(usdg.balanceOf(address(router)), 0);
        vm.prank(friend);
        gifts.open(giftId);
        assertEq(aapl.balanceOf(friend), 2e17);
    }

    function test_RouterFeeWithinTheBudget() public {
        vm.prank(alice);
        vm.expectRevert();
        router.setFee(treasury, 100);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.FeeTooHigh.selector, 501));
        router.setFee(treasury, 501);
        router.setFee(treasury, 100); // 1%
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.TotalSpendExceeded.selector, 80.8e6, 80e6));
        router.buyGift(_purchases(), 80e6, 500, address(gifts), friend, block.timestamp);
        vm.prank(alice);
        (,, uint256 fee, uint256 refunded) =
            router.buyGift(_purchases(), 80.8e6, 500, address(gifts), friend, block.timestamp);
        assertEq(fee, 0.8e6);
        assertEq(refunded, 0);
        assertEq(usdg.balanceOf(treasury), 0.8e6);
    }

    function test_RouterRejects() public {
        BasqitGiftRouter.Purchase[] memory p = _purchases();
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.DeadlineExpired.selector, block.timestamp - 1));
        router.buyGift(p, 100e6, 500, address(gifts), friend, block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(BasqitRouterBase.InvalidRecipient.selector, address(gifts)));
        router.buyGift(p, 100e6, 500, address(gifts), address(gifts), block.timestamp);
        p[0].adapter = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(BasqitRouterBase.AdapterNotAllowed.selector, address(0xBAD)));
        router.buyGift(p, 100e6, 500, address(gifts), friend, block.timestamp);
        p = _purchases();
        p[0].token = address(usdg);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.NotGiftListed.selector, address(usdg)));
        router.buyGift(p, 100e6, 500, address(gifts), friend, block.timestamp);
        p = _purchases();
        p[1].maxAmountIn = 59e6; // AAPL leg costs $60
        vm.expectRevert(abi.encodeWithSelector(TestnetSwapAdapter.ExcessiveInput.selector, 60e6, 59e6));
        router.buyGift(p, 100e6, 500, address(gifts), friend, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(TestnetSwapAdapter.ExcessiveInput.selector, 60e6, 50e6));
        router.buyGift(_purchases(), 70e6, 500, address(gifts), friend, block.timestamp); // budget runs out on the second leg
        vm.stopPrank();
    }

    function test_BuyerPinsTheFeeAndTheGiftsContract() public {
        router.setFee(treasury, 100);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.FeeAboveMax.selector, 100, 50));
        router.buyGift(_purchases(), 100e6, 50, address(gifts), friend, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(BasqitGiftRouter.GiftsMismatch.selector, address(0xBEEF), address(gifts))
        );
        router.buyGift(_purchases(), 100e6, 100, address(0xBEEF), friend, block.timestamp);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(BasqitRouterBase.InvalidRecipient.selector, address(router)));
        router.setFee(address(router), 100);
        vm.expectRevert(abi.encodeWithSelector(BasqitGiftRouter.NotAGiftsContract.selector, address(0xBEEF)));
        router.scheduleGifts(address(0xBEEF));
        BasqitGiftRouter.Purchase[] memory dup = _purchases();
        dup[1].token = address(nvda); // a repeated token stops before any swap
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.DuplicateToken.selector, address(nvda)));
        router.buyGift(dup, 100e6, 500, address(gifts), friend, block.timestamp);
    }

    function test_GiftsContractChangesOnlyAfterTheDelay() public {
        BasqitGifts next = new BasqitGifts(owner, address(factory));
        vm.prank(alice);
        vm.expectRevert();
        router.scheduleGifts(address(next));
        router.scheduleGifts(address(next));
        vm.prank(alice);
        (uint256 first,,,) = router.buyGift(_purchases(), 100e6, 500, address(gifts), friend, block.timestamp);
        assertEq(gifts.ownerOf(first), friend, "old contract until the delay passes");
        vm.warp(block.timestamp + router.ADAPTER_DELAY());
        assertEq(address(router.activeGifts()), address(next));
        vm.prank(alice);
        (uint256 second,,,) = router.buyGift(_purchases(), 100e6, 500, address(next), friend, block.timestamp);
        assertEq(next.ownerOf(second), friend);
        assertEq(address(router.gifts()), address(next));
    }

    function test_AdapterPricesAreOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        shop.setPrice(address(nvda), 1);
        vm.chainId(4663);
        vm.expectRevert(TestnetSwapAdapter.NotTestnet.selector);
        new TestnetSwapAdapter(address(usdg), owner);
    }

    function test_PausedItemIsOwedNotBlocking() public {
        PausableStock paus = new PausableStock();
        paus.mint(alice, 1e18);
        address[] memory list = new address[](1);
        list[0] = address(paus);
        factory.allowTokens(list);
        vm.warp(block.timestamp + factory.LISTING_DELAY());
        BasqitGifts.Item[] memory items = new BasqitGifts.Item[](2);
        items[0] = BasqitGifts.Item(address(nvda), 1e17);
        items[1] = BasqitGifts.Item(address(paus), 1e18);
        vm.startPrank(alice);
        paus.approve(address(gifts), type(uint256).max);
        uint256 giftId = gifts.wrap(items, alice);
        vm.stopPrank();
        paus.setPaused(true);
        uint256 before = nvda.balanceOf(alice);
        vm.prank(alice);
        gifts.open(giftId);
        assertEq(nvda.balanceOf(alice) - before, 1e17, "the working item arrives");
        assertEq(gifts.owed(alice, address(paus)), 1e18, "the paused item is owed");
        paus.setPaused(false);
        vm.prank(alice);
        gifts.claimOwed(address(paus), alice);
        assertEq(paus.balanceOf(alice), 1e18);
    }

    function test_DelistedTokenStillOpensAndGiftCanBePassedOn() public {
        vm.prank(alice);
        uint256 giftId = gifts.wrap(_one(address(nvda), 1e17), alice);
        address[] memory list = new address[](1);
        list[0] = address(nvda);
        factory.disallowTokens(list);
        vm.prank(alice);
        gifts.transferFrom(alice, friend, giftId);
        vm.prank(friend);
        gifts.open(giftId);
        assertEq(nvda.balanceOf(friend), 1e17);
    }

    function test_TokenUriIsOnChainPicture() public {
        vm.prank(alice);
        uint256 giftId = gifts.wrap(_one(address(nvda), 1e17), friend);
        string memory uri = gifts.tokenURI(giftId);
        assertEq(bytes(uri).length > 2000, true);
        vm.expectRevert();
        gifts.tokenURI(99);
    }

    function test_HolderPicksAListedPictureOnlyWhenOpen() public {
        vm.prank(alice);
        uint256 giftId = gifts.wrap(_one(address(nvda), 1e17), friend);
        string memory builtIn = gifts.tokenURI(giftId);

        vm.prank(alice);
        vm.expectRevert();
        gifts.addDesign("ipfs://ribbon");
        uint256 ribbon = gifts.addDesign("ipfs://ribbon");
        vm.expectRevert(BasqitGifts.BadImageUri.selector);
        gifts.addDesign('ipfs://x" onload="');
        vm.expectRevert(BasqitGifts.BadImageUri.selector);
        gifts.addDesign("javascript:alert(1)");

        vm.prank(friend);
        vm.expectRevert(BasqitGifts.DesignChoiceClosed.selector);
        gifts.chooseDesign(giftId, ribbon);

        gifts.setDesignChoiceOpen(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.NotHolder.selector, giftId));
        gifts.chooseDesign(giftId, ribbon);
        vm.prank(friend);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.BadDesign.selector, 2));
        gifts.chooseDesign(giftId, 2);
        vm.prank(friend);
        gifts.chooseDesign(giftId, ribbon);
        assertEq(gifts.designOf(giftId), ribbon);
        assertTrue(keccak256(bytes(gifts.tokenURI(giftId))) != keccak256(bytes(builtIn)), "picture changed");

        gifts.setDesign(ribbon, "");
        assertEq(gifts.tokenURI(giftId), builtIn);
        gifts.setDesignChoiceOpen(false);
        assertEq(gifts.designOf(giftId), ribbon);
        assertTrue(gifts.supportsInterface(0x49064906), "ERC-4906 metadata updates");
    }
}

contract TestnetFaucetTest is Test {
    function test_DripAndCooldown() public {
        MockUSDG usdg = new MockUSDG();
        BasqitTestnetFaucet faucet = new BasqitTestnetFaucet(address(usdg), 100e6, 1 days, 250e6);
        address alice = makeAddr("alice");
        vm.startPrank(alice);
        faucet.drip();
        assertEq(usdg.balanceOf(alice), 100e6);
        vm.expectRevert(abi.encodeWithSelector(BasqitTestnetFaucet.TooSoon.selector, block.timestamp + 1 days));
        faucet.drip();
        vm.warp(block.timestamp + 1 days);
        faucet.drip();
        assertEq(usdg.balanceOf(alice), 200e6);
        vm.stopPrank();
        // Global cap: 250 per day, so a third address on the same day is refused after two drips.
        vm.prank(makeAddr("bob"));
        faucet.drip();
        vm.prank(makeAddr("carol"));
        vm.expectRevert(BasqitTestnetFaucet.DailyCapReached.selector);
        faucet.drip();
    }

    function test_TestnetTokenOnlyOwnerAndMintersMint() public {
        TestnetToken token = new TestnetToken("Test USDG", "tUSDG", 6, address(this));
        address faucet = makeAddr("faucet");
        vm.prank(faucet);
        vm.expectRevert(TestnetToken.NotMinter.selector);
        token.mint(faucet, 1);
        token.setMinter(faucet, true);
        vm.prank(faucet);
        token.mint(faucet, 1);
        assertEq(token.decimals(), 6);
        vm.chainId(4663);
        vm.expectRevert(TestnetToken.NotTestnet.selector);
        new TestnetToken("x", "x", 18, address(this));
    }

    function test_RefusesMainnet() public {
        vm.chainId(4663);
        vm.expectRevert(BasqitTestnetFaucet.NotTestnet.selector);
        new BasqitTestnetFaucet(address(1), 1, 1, 1);
        vm.expectRevert(BasqitPacks.NotTestnet.selector);
        new BasqitPacks(address(this), address(1));
        vm.chainId(1);
        vm.expectRevert(BasqitTestnetFaucet.NotTestnet.selector);
        new BasqitTestnetFaucet(address(1), 1, 1, 1);
    }
}

/// Owner-controlled gift recipient that tries to raise the fee from inside `buyGift`.
contract GiftFeeCallbackTest is GiftsTest {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        router.setFee(treasury, 500);
        return this.onERC721Received.selector;
    }

    function test_setFeeCannotRunInsideBuyGift() public {
        vm.prank(alice);
        vm.expectRevert();
        router.buyGift(_purchases(), 100e6, 0, address(gifts), address(this), block.timestamp);
        assertEq(usdg.balanceOf(treasury), 0);
    }

    function test_giftCannotBeTransferredToGiftsContract() public {
        vm.prank(alice);
        uint256 id = gifts.wrap(_one(address(nvda), 1e17), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitGifts.InvalidRecipient.selector, address(gifts)));
        gifts.transferFrom(alice, address(gifts), id);
        vm.prank(alice);
        gifts.open(id);
    }
}

contract NonPayableDrawCaller {
    function draw(BasqitPacks packs, uint256 round) external payable {
        packs.requestDraw{ value: msg.value }(round);
    }

    function refundTo(BasqitPacks packs, uint256 round, address to) external {
        packs.refundDiceFeeTo(round, to);
    }
}

contract DiceFeeRefundToTest is PacksTest {
    function test_nonPayablePayerRedirectsDiceFee() public {
        uint256 id = _open(2);
        _sellOut(id, 2);
        NonPayableDrawCaller caller = new NonPayableDrawCaller();
        uint256 fee = packs.drawFee();
        vm.deal(address(this), 1 ether);
        caller.draw{ value: fee }(packs, id);
        vm.warp(block.timestamp + DRAW + 1);
        packs.cancel(id);

        vm.expectRevert(BasqitPacks.EthTransferFailed.selector);
        packs.refundDiceFee(id);
        vm.expectRevert(BasqitPacks.NotFeePayer.selector);
        packs.refundDiceFeeTo(id, alice);

        uint256 before = alice.balance;
        caller.refundTo(packs, id, alice);
        assertEq(alice.balance - before, fee);
        assertEq(packs.getRound(id).feePayer, address(0));
    }
}
