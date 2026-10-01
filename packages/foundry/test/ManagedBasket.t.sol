// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../contracts/BasqitSellRouter.sol";
import { BasqitRebalanceRouter } from "../contracts/BasqitRebalanceRouter.sol";
import { BasqitToken } from "../contracts/BasqitToken.sol";
import { IBasqitRebalanceRouter } from "../contracts/interfaces/IBasqitRebalanceRouter.sol";
import { IPriceReference } from "../contracts/interfaces/IPriceReference.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { IssuerToken } from "./Basqit.t.sol";

/// @dev A price reference that can disagree with the venue, to exercise the guard.
contract MockReference is IPriceReference {
    mapping(address => uint256) public priceUsdG;

    function set(address token, uint256 price) external {
        priceUsdG[token] = price;
    }
}

contract ManagedBasketTest is Test {
    MockUSDG internal usdG;
    MockStockToken internal tsla;
    MockStockToken internal nvda;
    MockStockToken internal weth;
    TestnetSwapAdapter internal shop;
    BasqitFactory internal factory;
    BasqitPurchaseRouter internal buyRouter;
    BasqitSellRouter internal sellRouter;
    BasqitRebalanceRouter internal rebalanceRouter;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdG = new MockUSDG();
        tsla = new MockStockToken("Tesla", "TSLA");
        nvda = new MockStockToken("NVIDIA", "NVDA");
        weth = new MockStockToken("Wrapped Ether", "WETH");

        shop = new TestnetSwapAdapter(address(usdG), address(this));
        shop.setPrice(address(tsla), 400e6);
        shop.setPrice(address(nvda), 250e6);
        shop.setPrice(address(weth), 3000e6);
        tsla.mint(address(shop), 1_000e18);
        nvda.mint(address(shop), 1_000e18);
        weth.mint(address(shop), 1_000e18);
        usdG.mint(address(shop), 10_000_000e6);

        address[] memory allowed = new address[](4);
        allowed[0] = address(tsla);
        allowed[1] = address(nvda);
        allowed[2] = address(usdG);
        allowed[3] = address(weth);
        factory = new BasqitFactory(owner, address(usdG), allowed, address(shop));

        address[] memory adapters = new address[](1);
        adapters[0] = address(shop);
        buyRouter = new BasqitPurchaseRouter(address(usdG), address(factory), owner, adapters);
        sellRouter = new BasqitSellRouter(address(usdG), address(factory), owner, adapters);
        rebalanceRouter = new BasqitRebalanceRouter(address(usdG), address(factory), owner, adapters);
        vm.prank(owner);
        factory.scheduleRebalanceRouter(address(rebalanceRouter));
    }

    // --- Helpers --------------------------------------------------------------------------

    /// One share = 1 TSLA + 1 NVDA ($650); alice mints 10.
    function _managed(uint8 noticeHours, uint16 slippageBps) internal returns (BasqitToken basket) {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        c[1] = BasqitToken.Component(address(nvda), 1e18);
        vm.prank(creator);
        basket = BasqitToken(
            factory.createBasket("Duo", "DUO", c, 0, BasqitFactory.Management(true, noticeHours, slippageBps))
        );
        _mint(basket, 10e18);
    }

    function _mint(BasqitToken basket, uint256 shares) internal {
        uint256[] memory amounts = basket.quoteMint(shares);
        BasqitToken.Component[] memory c = basket.components();
        vm.startPrank(alice);
        for (uint256 i = 0; i < c.length; i++) {
            if (c[i].token == address(usdG)) usdG.mint(alice, amounts[i]);
            else MockStockToken(c[i].token).mint(alice, amounts[i]);
            MockStockToken(c[i].token).approve(address(basket), amounts[i]);
        }
        basket.mint(shares, alice);
        vm.stopPrank();
    }

    function _sell(address token, uint256 units) internal pure returns (BasqitToken.Sell[] memory s) {
        s = new BasqitToken.Sell[](1);
        s[0] = BasqitToken.Sell(token, units);
    }

    function _buy(address token) internal pure returns (BasqitToken.Buy[] memory b) {
        b = new BasqitToken.Buy[](1);
        b[0] = BasqitToken.Buy(token, 10_000);
    }

    function _legs(uint256 count) internal view returns (IBasqitRebalanceRouter.Leg[] memory legs) {
        legs = new IBasqitRebalanceRouter.Leg[](count);
        for (uint256 i = 0; i < count; i++) {
            legs[i] = IBasqitRebalanceRouter.Leg(address(shop), 0, "");
        }
    }

    function _units(BasqitToken basket, address token) internal view returns (uint256) {
        BasqitToken.Component[] memory c = basket.components();
        for (uint256 i = 0; i < c.length; i++) {
            if (c[i].token == token) return c[i].unitsPerShare;
        }
        return 0;
    }

    function _now(BasqitToken basket, BasqitToken.Sell[] memory s, BasqitToken.Buy[] memory b) internal {
        vm.prank(creator);
        basket.rebalanceNow(s, b, _legs(s.length), _legs(b.length), block.timestamp);
    }

    // --- Rebalancing ----------------------------------------------------------------------

    /// The example from the design: half the TSLA goes into NVDA.
    function test_rebalanceNow_movesHalfIntoAnotherComponent() public {
        BasqitToken basket = _managed(0, 100);
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(nvda)));

        // 5 TSLA sold for 2,000 USDG buys 8 NVDA; 18 NVDA over 10 shares.
        assertEq(_units(basket, address(tsla)), 0.5e18);
        assertEq(_units(basket, address(nvda)), 1.8e18);
        assertEq(tsla.balanceOf(address(basket)), 5e18);
        assertEq(nvda.balanceOf(address(basket)), 18e18);
        assertTrue(basket.isFullyBacked());
        assertEq(basket.lastRebalanceAt(), block.timestamp);

        // Holders redeem the new holdings.
        vm.prank(alice);
        basket.redeem(1e18, alice);
        assertEq(tsla.balanceOf(alice), 0.5e18);
        assertEq(nvda.balanceOf(alice), 1.8e18);
    }

    /// Selling a component to zero removes it; proceeds can split into WETH and USDG, which become components.
    function test_rebalanceNow_removesComponentAndAddsWethAndUsdG() public {
        BasqitToken basket = _managed(0, 100);
        BasqitToken.Buy[] memory b = new BasqitToken.Buy[](2);
        b[0] = BasqitToken.Buy(address(weth), 5000);
        b[1] = BasqitToken.Buy(address(usdG), 5000);
        _now(basket, _sell(address(tsla), 0), b);

        assertEq(basket.componentCount(), 3);
        assertEq(_units(basket, address(tsla)), 0);
        assertEq(_units(basket, address(nvda)), 1e18);
        // 4,000 USDG proceeds: 2,000 buys 0.666… WETH, 2,000 stays as USDG.
        assertEq(_units(basket, address(weth)), uint256(2000e6) * 1e18 / 3000e6 * 1e18 / 10e18);
        assertEq(_units(basket, address(usdG)), 200e6);
        assertTrue(basket.isFullyBacked());
        assertEq(usdG.balanceOf(address(rebalanceRouter)), 0, "router keeps nothing");
        assertEq(weth.balanceOf(address(rebalanceRouter)), 0, "router keeps nothing");
    }

    /// A basket holding USDG trades through both routers: the USDG part needs no swap.
    function test_usdGComponent_buyAndSellThroughRouters() public {
        BasqitToken basket = _managed(0, 100);
        _now(basket, _sell(address(tsla), 0), _buy(address(usdG)));
        assertEq(_units(basket, address(usdG)), 400e6);

        uint256 count = basket.componentCount();
        BasqitPurchaseRouter.SwapInstruction[] memory buys = new BasqitPurchaseRouter.SwapInstruction[](count);
        BasqitSellRouter.SwapInstruction[] memory sells = new BasqitSellRouter.SwapInstruction[](count);
        for (uint256 i = 0; i < count; i++) {
            buys[i] = BasqitPurchaseRouter.SwapInstruction(address(shop), type(uint128).max, "");
            sells[i] = BasqitSellRouter.SwapInstruction(address(shop), 0, "");
        }
        usdG.mint(alice, 650e6);
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), 650e6);
        (uint256 spent,,) = buyRouter.buyBasket(address(basket), 1e18, 650e6, buys, alice, block.timestamp);
        assertEq(spent, 650e6, "1 NVDA at 250 plus 400 USDG");
        assertEq(basket.balanceOf(alice), 11e18);

        basket.approve(address(sellRouter), 1e18);
        (uint256 paid,) = sellRouter.sellBasket(address(basket), 1e18, 650e6, sells, alice, block.timestamp);
        vm.stopPrank();
        assertEq(paid, 650e6);
        assertEq(usdG.balanceOf(address(buyRouter)), 0);
        assertEq(usdG.balanceOf(address(sellRouter)), 0);
    }

    function testFuzz_rebalanceKeepsBackingAndValue(uint256 keep, uint16 split) public {
        BasqitToken basket = _managed(0, 100);
        keep = bound(keep, 0, 1e18 - 1);
        split = uint16(bound(split, 1, 9999));
        BasqitToken.Buy[] memory b = new BasqitToken.Buy[](2);
        b[0] = BasqitToken.Buy(address(nvda), split);
        b[1] = BasqitToken.Buy(address(weth), 10_000 - split);
        uint256 nvdaBefore = nvda.balanceOf(address(basket));
        uint256 sold = (1e18 - keep) * 10;
        // Dust-sized splits can buy zero of a token; that is rejected rather than recorded as a zero holding.
        uint256 proceeds = sold * 400e6 / 1e18;
        if (
            proceeds * split / 10_000 * 1e18 / 250e6 < 10 || (proceeds - proceeds * split / 10_000) * 1e18 / 3000e6 < 10
        ) {
            return;
        }
        _now(basket, _sell(address(tsla), keep), b);
        assertTrue(basket.isFullyBacked());
        assertEq(_units(basket, address(tsla)), keep);
        assertGe(nvda.balanceOf(address(basket)), nvdaBefore);
    }

    // --- Notice, window, cadence ----------------------------------------------------------

    function test_notice_scheduleWaitExecute() public {
        BasqitToken basket = _managed(24, 100);
        vm.startPrank(creator);
        vm.expectRevert(BasqitToken.NoticeRequired.selector);
        basket.rebalanceNow(_sell(address(tsla), 0.5e18), _buy(address(nvda)), _legs(1), _legs(1), block.timestamp);

        basket.scheduleRebalance(_sell(address(tsla), 0.5e18), _buy(address(nvda)));
        uint64 readyAt = uint64(block.timestamp + 24 hours);
        assertEq(basket.rebalanceReadyAt(), readyAt);
        vm.expectRevert(BasqitToken.RebalancePending.selector);
        basket.scheduleRebalance(_sell(address(tsla), 0.5e18), _buy(address(nvda)));

        vm.expectRevert(abi.encodeWithSelector(BasqitToken.RebalanceNotReady.selector, readyAt));
        basket.executeRebalance(_legs(1), _legs(1), block.timestamp);
        vm.stopPrank();

        // Holders can still mint and redeem at the old holdings while it is pending.
        vm.prank(alice);
        basket.redeem(1e18, alice);
        assertEq(tsla.balanceOf(alice), 1e18);

        vm.warp(readyAt);
        vm.prank(creator);
        basket.executeRebalance(_legs(1), _legs(1), block.timestamp);
        assertEq(_units(basket, address(tsla)), 0.5e18);
        assertEq(basket.rebalanceReadyAt(), 0);
    }

    function test_notice_planLapsesAfterWindow() public {
        BasqitToken basket = _managed(1, 100);
        vm.startPrank(creator);
        basket.scheduleRebalance(_sell(address(tsla), 0.5e18), _buy(address(nvda)));
        uint64 expiry = uint64(block.timestamp + 1 hours + basket.EXECUTION_WINDOW());
        vm.warp(expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.RebalanceExpired.selector, expiry));
        basket.executeRebalance(_legs(1), _legs(1), block.timestamp);
        // A lapsed plan is simply replaced by the next one.
        basket.scheduleRebalance(_sell(address(tsla), 0.6e18), _buy(address(nvda)));
        (BasqitToken.Sell[] memory s,,) = basket.pendingRebalance();
        assertEq(s[0].unitsPerShare, 0.6e18);
        vm.stopPrank();
    }

    function test_cancel() public {
        BasqitToken basket = _managed(24, 100);
        vm.startPrank(creator);
        vm.expectRevert(BasqitToken.NoRebalancePending.selector);
        basket.cancelRebalance();
        basket.scheduleRebalance(_sell(address(tsla), 0.5e18), _buy(address(nvda)));
        basket.cancelRebalance();
        (BasqitToken.Sell[] memory s,, uint64 readyAt) = basket.pendingRebalance();
        assertEq(s.length, 0);
        assertEq(readyAt, 0);
        vm.expectRevert(BasqitToken.NoRebalancePending.selector);
        basket.executeRebalance(_legs(1), _legs(1), block.timestamp);
        vm.stopPrank();
    }

    function test_interval_blocksQuickRepeat() public {
        BasqitToken basket = _managed(0, 100);
        _now(basket, _sell(address(tsla), 0.8e18), _buy(address(nvda)));
        uint64 next = uint64(block.timestamp + basket.MIN_REBALANCE_INTERVAL());
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.RebalanceTooSoon.selector, next));
        vm.prank(creator);
        basket.rebalanceNow(_sell(address(tsla), 0.5e18), _buy(address(nvda)), _legs(1), _legs(1), block.timestamp);
        vm.warp(next);
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(nvda)));
    }

    // --- Price guard ----------------------------------------------------------------------

    function _referenceWith(uint256 nvdaPrice) internal {
        MockReference ref = new MockReference();
        ref.set(address(tsla), 400e6);
        ref.set(address(nvda), nvdaPrice);
        vm.prank(owner);
        factory.schedulePriceReference(address(ref));
        vm.warp(block.timestamp + factory.SETTINGS_CHANGE_DELAY());
        assertEq(address(factory.priceReference()), address(ref));
    }

    function test_guard_rejectsLossBeyondSlippage() public {
        BasqitToken basket = _managed(0, 100);
        // The venue sells NVDA at 250 but the reference says 240: the bought NVDA is worth 4% less.
        _referenceWith(240e6);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.ValueLost.selector, 2000e6, 1920e6));
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(nvda)));
        assertEq(_units(basket, address(tsla)), 1e18, "nothing changed");
    }

    function test_guard_allowsLossWithinSlippage() public {
        BasqitToken basket = _managed(0, 100);
        _referenceWith(248e6); // 0.8% below the venue
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(nvda)));
        assertEq(_units(basket, address(nvda)), 1.8e18);
    }

    function test_guard_rejectsMissingReferencePrice() public {
        BasqitToken basket = _managed(0, 100);
        _referenceWith(0);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.NoReferencePrice.selector, address(nvda)));
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(nvda)));
    }

    function test_guard_rejectsLyingRouterLegs() public {
        BasqitToken basket = _managed(0, 100);
        IBasqitRebalanceRouter.Leg[] memory legs = _legs(1);
        legs[0].minAmountOut = 9e18; // asks for more NVDA than 2,000 USDG buys
        vm.expectRevert();
        vm.prank(creator);
        basket.rebalanceNow(_sell(address(tsla), 0.5e18), _buy(address(nvda)), _legs(1), legs, block.timestamp);
    }

    // --- Plan checks ----------------------------------------------------------------------

    function test_plan_rejectsBadShapes() public {
        BasqitToken basket = _managed(24, 100);
        vm.startPrank(creator);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.NotReduced.selector, address(tsla)));
        basket.scheduleRebalance(_sell(address(tsla), 1e18), _buy(address(nvda)));
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.NotComponent.selector, address(weth)));
        basket.scheduleRebalance(_sell(address(weth), 0), _buy(address(nvda)));
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.DuplicateToken.selector, address(tsla)));
        basket.scheduleRebalance(_sell(address(tsla), 0), _buy(address(tsla)));
        BasqitToken.Buy[] memory b = _buy(address(nvda));
        b[0].bps = 9999;
        vm.expectRevert(BasqitToken.InvalidSplit.selector);
        basket.scheduleRebalance(_sell(address(tsla), 0), b);
        vm.expectRevert(BasqitToken.EmptyPlan.selector);
        basket.scheduleRebalance(new BasqitToken.Sell[](0), _buy(address(nvda)));
        vm.stopPrank();
    }

    function test_plan_rejectsTokenNotYetOrNoLongerAllowed() public {
        BasqitToken basket = _managed(0, 100);
        MockStockToken fresh = new MockStockToken("Fresh", "NEW");
        address[] memory list = new address[](1);
        list[0] = address(fresh);
        vm.prank(owner);
        factory.allowTokens(list);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.TokenNotAllowed.selector, address(fresh)));
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(fresh)));

        list[0] = address(weth);
        vm.prank(owner);
        factory.disallowTokens(list);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.TokenNotAllowed.selector, address(weth)));
        _now(basket, _sell(address(tsla), 0.5e18), _buy(address(weth)));

        // Rebalancing out of a disallowed token still works.
        list[0] = address(tsla);
        vm.prank(owner);
        factory.disallowTokens(list);
        _now(basket, _sell(address(tsla), 0), _buy(address(nvda)));
    }

    function test_plan_needsShares() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        vm.prank(creator);
        BasqitToken empty = BasqitToken(factory.createBasket("E", "E", c, 0, BasqitFactory.Management(true, 0, 100)));
        vm.expectRevert(BasqitToken.NoShares.selector);
        _now(empty, _sell(address(tsla), 0.5e18), _buy(address(nvda)));
    }

    // --- Access ---------------------------------------------------------------------------

    function test_access_onlyManager() public {
        BasqitToken basket = _managed(0, 100);
        vm.expectRevert(BasqitToken.NotManager.selector);
        vm.prank(alice);
        basket.rebalanceNow(_sell(address(tsla), 0.5e18), _buy(address(nvda)), _legs(1), _legs(1), block.timestamp);
        assertEq(basket.manager(), creator);
    }

    function test_access_fixedBasketNeverChanges() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        vm.startPrank(creator);
        BasqitToken fixedBasket =
            BasqitToken(factory.createBasket("F", "F", c, 0, BasqitFactory.Management(false, 0, 0)));
        vm.expectRevert(BasqitToken.NotManaged.selector);
        fixedBasket.scheduleRebalance(_sell(address(tsla), 0), _buy(address(nvda)));
        vm.expectRevert(BasqitToken.NotManaged.selector);
        fixedBasket.rebalanceNow(_sell(address(tsla), 0), _buy(address(nvda)), _legs(1), _legs(1), block.timestamp);
        vm.stopPrank();
        assertEq(fixedBasket.manager(), address(0));
    }

    function test_access_routerOnlyServesBaskets() public {
        vm.expectRevert(abi.encodeWithSelector(BasqitRebalanceRouter.BasketNotRegistered.selector, alice));
        vm.prank(alice);
        rebalanceRouter.rebalance(
            new address[](0), new uint256[](0), new address[](1), new uint16[](1), _legs(0), _legs(1)
        );
    }

    // --- Factory settings -----------------------------------------------------------------

    function test_factory_managementBounds() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        vm.startPrank(creator);
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.NoticeTooLong.selector, 73));
        factory.createBasket("x", "x", c, 0, BasqitFactory.Management(true, 73, 100));
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.SlippageOutOfRange.selector, 201));
        factory.createBasket("x", "x", c, 0, BasqitFactory.Management(true, 0, 201));
        vm.expectRevert(BasqitFactory.UnmanagedSettings.selector);
        factory.createBasket("x", "x", c, 0, BasqitFactory.Management(false, 24, 0));
        BasqitToken b = BasqitToken(factory.createBasket("x", "x", c, 0, BasqitFactory.Management(true, 72, 200)));
        vm.stopPrank();
        assertEq(b.noticePeriod(), 72 hours);
        assertEq(b.maxSlippageBps(), 200);
    }

    function test_factory_routerAndReferenceChangesWait() public {
        BasqitRebalanceRouter next = new BasqitRebalanceRouter(address(usdG), address(factory), owner, new address[](0));
        MockReference ref = new MockReference();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.NotAContract.selector, alice));
        factory.schedulePriceReference(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.NotAContract.selector, alice));
        factory.scheduleRebalanceRouter(alice);
        factory.schedulePriceReference(address(ref));
        factory.scheduleRebalanceRouter(address(next));
        vm.stopPrank();
        assertEq(address(factory.priceReference()), address(shop), "old reference until the delay passes");
        assertEq(factory.rebalanceRouter(), address(rebalanceRouter), "old router until the delay passes");
        vm.warp(block.timestamp + factory.SETTINGS_CHANGE_DELAY());
        assertEq(address(factory.priceReference()), address(ref));
        assertEq(factory.rebalanceRouter(), address(next));

        vm.expectRevert();
        vm.prank(alice);
        factory.schedulePriceReference(address(ref));
    }

    function test_factory_slippageFloor() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.SlippageOutOfRange.selector, 9));
        vm.prank(creator);
        factory.createBasket("x", "x", c, 0, BasqitFactory.Management(true, 0, 9));
    }

    // --- Review fixes -----------------------------------------------------------------------

    function test_lossBudget_capsRepeatedLosses() public {
        BasqitToken basket = _managed(0, 100);
        _referenceWith(248e6); // the venue sells NVDA at 250: each TSLA→NVDA rebalance loses 0.8%
        _now(basket, _sell(address(tsla), 0.8e18), _buy(address(nvda)));
        skip(4 hours);
        _now(basket, _sell(address(tsla), 0.6e18), _buy(address(nvda)));
        assertEq(basket.lossBpsInWindow(), 160);
        skip(4 hours);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.LossBudgetExceeded.selector, 240, 200));
        _now(basket, _sell(address(tsla), 0.4e18), _buy(address(nvda)));
        vm.warp(basket.lossWindowStart() + basket.LOSS_WINDOW());
        _now(basket, _sell(address(tsla), 0.4e18), _buy(address(nvda)));
        assertEq(basket.lossBpsInWindow(), 80, "a new window starts");
    }

    function test_removal_sellsSurplusToo() public {
        BasqitToken basket = _managed(0, 100);
        tsla.mint(address(basket), 1e18); // a donation above the backing
        _now(basket, _sell(address(tsla), 0), _buy(address(nvda)));
        assertEq(tsla.balanceOf(address(basket)), 0, "nothing left behind once TSLA is no longer a component");
        assertEq(_units(basket, address(nvda)), 2.76e18); // (10 + 11 TSLA × 400 / 250) / 10
    }

    function test_deadline() public {
        BasqitToken basket = _managed(0, 100);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.DeadlineExpired.selector, block.timestamp - 1));
        vm.prank(creator);
        basket.rebalanceNow(_sell(address(tsla), 0.5e18), _buy(address(nvda)), _legs(1), _legs(1), block.timestamp - 1);
    }

    function test_plan_rejectsTooManyComponentsAtScheduling() public {
        BasqitToken basket = _managed(24, 100);
        BasqitToken.Buy[] memory b = new BasqitToken.Buy[](9);
        for (uint256 i = 0; i < 9; i++) {
            b[i] = BasqitToken.Buy(address(new MockStockToken("x", "x")), i == 0 ? 2000 : 1000);
        }
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.TooManyComponents.selector, 11));
        vm.prank(creator);
        basket.scheduleRebalance(_sell(address(tsla), 0.5e18), b);
    }

    /// Issuer-token scenarios: a transfer fee, an admin burn, and past redeemers' unpaid claims.
    function _issuerBasket() internal returns (BasqitToken basket, IssuerToken iss) {
        iss = new IssuerToken();
        iss.mint(address(shop), 1_000e18);
        shop.setPrice(address(iss), 400e6);
        address[] memory list = new address[](1);
        list[0] = address(iss);
        vm.prank(owner);
        factory.allowTokens(list);
        vm.warp(block.timestamp + factory.LISTING_DELAY());
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(iss), 1e18);
        c[1] = BasqitToken.Component(address(nvda), 1e18);
        vm.prank(creator);
        basket = BasqitToken(factory.createBasket("Iss", "ISS", c, 0, BasqitFactory.Management(true, 0, 200)));
        iss.mint(alice, 10e18);
        _mint(basket, 10e18);
    }

    function test_feeOnTransfer_doesNotBlockSellingOut() public {
        (BasqitToken basket, IssuerToken iss) = _issuerBasket();
        iss.setFeeBps(100); // 1%, inside the 2% limit
        _now(basket, _sell(address(iss), 0), _buy(address(nvda)));
        assertEq(basket.componentCount(), 1);
        assertEq(iss.balanceOf(address(rebalanceRouter)), 0);
    }

    function test_underBackedComponent_doesNotFreezeRebalancing() public {
        (BasqitToken basket, IssuerToken iss) = _issuerBasket();
        iss.adminBurn(address(basket), 1);
        assertFalse(basket.isFullyBacked());
        _now(basket, _sell(address(nvda), 0.5e18), _buy(address(usdG)));
        vm.warp(block.timestamp + 4 hours);
        _now(basket, _sell(address(iss), 0), _buy(address(nvda)));
        assertTrue(basket.isFullyBacked(), "selling the short token out restores full backing");
    }

    function test_guard_chargesTokensThatFillUnpaidClaims() public {
        (BasqitToken basket, IssuerToken iss) = _issuerBasket();
        iss.setPaused(true);
        vm.prank(alice);
        basket.redeemAvailable(5e18, alice); // 5 ISS owed to alice
        iss.setPaused(false);
        _now(basket, _sell(address(iss), 0), _buy(address(nvda)));
        iss.adminBurn(address(basket), 4e18); // the basket now holds 1 ISS against 5 owed
        vm.warp(block.timestamp + 4 hours);
        // Buying ISS back first fills alice's claim: 2,000 USDG of NVDA sold, only 400 of it reaches holders.
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.ValueLost.selector, 2000e6, 400e6));
        _now(basket, _sell(address(nvda), 1e18), _buy(address(iss)));
    }

    function test_factory_basketCreatedDescribesTheBasket() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        c[1] = BasqitToken.Component(address(nvda), 0.5e18);
        BasqitFactory.Management memory m = BasqitFactory.Management(true, 24, 100);

        vm.recordLogs();
        vm.prank(creator);
        address basket = factory.createBasket("Duo", "DUO", c, 50, m);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        Vm.Log memory created = logs[logs.length - 1];
        assertEq(created.topics[0], BasqitFactory.BasketCreated.selector);
        assertEq(address(uint160(uint256(created.topics[1]))), basket);
        assertEq(address(uint160(uint256(created.topics[2]))), creator);
        (
            string memory name,
            string memory symbol,
            uint16 fee,
            BasqitToken.Component[] memory parts,
            BasqitFactory.Management memory rules
        ) = abi.decode(created.data, (string, string, uint16, BasqitToken.Component[], BasqitFactory.Management));
        assertEq(name, "Duo");
        assertEq(symbol, "DUO");
        assertEq(fee, 50);
        assertEq(parts.length, 2);
        assertEq(parts[1].token, address(nvda));
        assertEq(parts[1].unitsPerShare, 0.5e18);
        assertTrue(rules.managed);
        assertEq(rules.noticeHours, 24);
        assertEq(rules.maxSlippageBps, 100);
    }
}
