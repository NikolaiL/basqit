// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../contracts/BasqitSellRouter.sol";
import { BasqitToken } from "../contracts/BasqitToken.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";
import { IssuerToken } from "./Basqit.t.sol";

/// @dev Random buys, sells, direct mints and redeems by several users, with fees on.
contract BasqitHandler is Test {
    MockUSDG internal usdG;
    MockStockToken[2] internal stocks;
    BasqitToken internal basket;
    BasqitPurchaseRouter internal buyRouter;
    BasqitSellRouter internal sellRouter;
    TestnetSwapAdapter internal adapter;
    address[3] internal actors = [address(0xA11CE), address(0xB0B), address(0xCA7)];

    uint256 public feesAccruedBuy;
    uint256 public feesAccruedSell;

    constructor(
        MockUSDG usdG_,
        MockStockToken[2] memory stocks_,
        BasqitToken basket_,
        BasqitPurchaseRouter buyRouter_,
        BasqitSellRouter sellRouter_,
        TestnetSwapAdapter adapter_
    ) {
        usdG = usdG_;
        stocks = stocks_;
        basket = basket_;
        buyRouter = buyRouter_;
        sellRouter = sellRouter_;
        adapter = adapter_;
        for (uint256 i = 0; i < actors.length; i++) {
            usdG.mint(actors[i], 1e15);
            for (uint256 j = 0; j < 2; j++) {
                stocks[j].mint(actors[i], 1e24);
            }
        }
    }

    function buy(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        shares = bound(shares, 1, 5e18);
        BasqitPurchaseRouter.SwapInstruction[] memory swaps = new BasqitPurchaseRouter.SwapInstruction[](2);
        swaps[0] = BasqitPurchaseRouter.SwapInstruction(address(adapter), type(uint128).max, "");
        swaps[1] = BasqitPurchaseRouter.SwapInstruction(address(adapter), type(uint128).max, "");
        vm.startPrank(actor);
        usdG.approve(address(buyRouter), 1e13);
        (, uint256 fee,) = buyRouter.buyBasket(address(basket), shares, 1e13, swaps, actor, block.timestamp);
        vm.stopPrank();
        feesAccruedBuy += fee;
    }

    function sell(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = basket.balanceOf(actor);
        // Amounts that redeem to nothing are rejected by design (tested separately).
        if (balance < 1e12) return;
        shares = bound(shares, 1e12, balance);
        BasqitSellRouter.SwapInstruction[] memory swaps = new BasqitSellRouter.SwapInstruction[](2);
        swaps[0] = BasqitSellRouter.SwapInstruction(address(adapter), 0, "");
        swaps[1] = BasqitSellRouter.SwapInstruction(address(adapter), 0, "");
        vm.startPrank(actor);
        basket.approve(address(sellRouter), shares);
        (, uint256 fee) = sellRouter.sellBasket(address(basket), shares, 0, swaps, actor, block.timestamp);
        vm.stopPrank();
        feesAccruedSell += fee;
    }

    function mintDirect(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        shares = bound(shares, 1, 5e18);
        vm.startPrank(actor);
        stocks[0].approve(address(basket), type(uint256).max);
        stocks[1].approve(address(basket), type(uint256).max);
        basket.mint(shares, actor);
        vm.stopPrank();
    }

    function redeemDirect(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = basket.balanceOf(actor);
        if (balance == 0) return;
        vm.prank(actor);
        basket.redeem(bound(shares, 1, balance), actor);
    }
}

contract BasqitInvariantTest is Test {
    MockUSDG internal usdG;
    MockStockToken[2] internal stocks;
    BasqitToken internal basket;
    BasqitPurchaseRouter internal buyRouter;
    BasqitSellRouter internal sellRouter;
    BasqitHandler internal handler;
    address internal creator = address(0xC0FFEE);

    // Odd unit sizes make rounding matter.
    uint256 internal constant UNITS_0 = 0.333333333333333333e18;
    uint256 internal constant UNITS_1 = 1.7e18;

    function setUp() public {
        usdG = new MockUSDG();
        stocks[0] = new MockStockToken("A", "A");
        stocks[1] = new MockStockToken("B", "B");
        address[] memory listed = new address[](2);
        listed[0] = address(stocks[0]);
        listed[1] = address(stocks[1]);
        BasqitFactory factory = new BasqitFactory(address(this), listed);
        factory.setFeesEnabled(true);
        vm.warp(block.timestamp + factory.FEE_CHANGE_DELAY());

        TestnetSwapAdapter adapter = new TestnetSwapAdapter(address(usdG), address(this));
        adapter.setPrice(address(stocks[0]), 123.456789e6);
        adapter.setPrice(address(stocks[1]), 7.77e6);
        stocks[0].mint(address(adapter), 1e30);
        stocks[1].mint(address(adapter), 1e30);
        usdG.mint(address(adapter), 1e18);

        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);
        buyRouter = new BasqitPurchaseRouter(address(usdG), address(factory), address(this), adapters);
        sellRouter = new BasqitSellRouter(address(usdG), address(factory), address(this), adapters);

        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(stocks[0]), UNITS_0);
        c[1] = BasqitToken.Component(address(stocks[1]), UNITS_1);
        vm.prank(creator);
        basket = BasqitToken(factory.createBasket("Odd", "ODD", c, 100));

        handler = new BasqitHandler(usdG, stocks, basket, buyRouter, sellRouter, adapter);
        targetContract(address(handler));
    }

    /// Every share can always be redeemed: reserves cover the total supply at the rounded-down rate.
    function invariant_basketIsFullyBacked() public view {
        uint256 supply = basket.totalSupply();
        assertGe(stocks[0].balanceOf(address(basket)), supply * UNITS_0 / 1e18);
        assertGe(stocks[1].balanceOf(address(basket)), supply * UNITS_1 / 1e18);
    }

    /// Every fee reaches the creator and routers keep nothing: no USDG, shares or components.
    function invariant_feesReachCreatorAndRoutersStayEmpty() public view {
        assertEq(usdG.balanceOf(creator), handler.feesAccruedBuy() + handler.feesAccruedSell());
        assertEq(usdG.balanceOf(address(buyRouter)), 0);
        assertEq(usdG.balanceOf(address(sellRouter)), 0);
        assertEq(basket.balanceOf(address(sellRouter)), 0);
        assertEq(stocks[0].balanceOf(address(buyRouter)), 0);
        assertEq(stocks[1].balanceOf(address(sellRouter)), 0);
    }
}

/// @dev Direct mints and redeems around an issuer-controlled component: pauses, partial redemptions that leave
/// owed debt, issuer burns and top-ups, and owed claims.
contract BasqitDebtHandler is Test {
    BasqitToken internal basket;
    MockStockToken internal plain;
    IssuerToken internal iss;
    address[3] internal actors = [address(0xA11CE), address(0xB0B), address(0xCA7)];
    /// Set if a mint ever succeeds while a component cannot cover both owed debt and every share.
    bool public mintedIntoDeficit;

    constructor(BasqitToken basket_, MockStockToken plain_, IssuerToken iss_) {
        basket = basket_;
        plain = plain_;
        iss = iss_;
        for (uint256 i = 0; i < actors.length; i++) {
            plain.mint(actors[i], 1e24);
            iss.mint(actors[i], 1e24);
            vm.startPrank(actors[i]);
            plain.approve(address(basket), type(uint256).max);
            iss.approve(address(basket), type(uint256).max);
            vm.stopPrank();
        }
    }

    function mint(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        vm.prank(actor);
        try basket.mint(bound(shares, 1, 5e18), actor) {
            uint256 supply = basket.totalSupply();
            if (
                iss.balanceOf(address(basket)) < basket.totalOwed(address(iss)) + supply
                    || plain.balanceOf(address(basket)) < basket.totalOwed(address(plain)) + supply
            ) mintedIntoDeficit = true;
        } catch { }
    }

    function redeemAvailable(uint256 actorSeed, uint256 shares) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = basket.balanceOf(actor);
        if (balance == 0) return;
        vm.prank(actor);
        basket.redeemAvailable(bound(shares, 1, balance), actor);
    }

    /// Full exits make zero supply with unpaid debt reachable, the state a plain amount rarely hits.
    function exitAll(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = basket.balanceOf(actor);
        if (balance == 0) return;
        vm.prank(actor);
        basket.redeemAvailable(balance, actor);
    }

    function claimOwed(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (basket.owed(actor, address(iss)) == 0) return;
        vm.prank(actor);
        try basket.claimOwed(address(iss), actor) { } catch { }
    }

    function setPaused(bool value) external {
        iss.setPaused(value);
    }

    function issuerBurn(uint256 amount) external {
        uint256 balance = iss.balanceOf(address(basket));
        if (balance == 0) return;
        iss.adminBurn(address(basket), bound(amount, 1, balance));
    }

    function issuerTopUp(uint256 amount) external {
        iss.mint(address(basket), bound(amount, 1, 10e18));
    }
}

contract BasqitDebtInvariantTest is Test {
    BasqitToken internal basket;
    IssuerToken internal iss;
    BasqitDebtHandler internal handler;

    function setUp() public {
        MockStockToken plain = new MockStockToken("A", "A");
        iss = new IssuerToken();
        address[] memory listed = new address[](2);
        listed[0] = address(plain);
        listed[1] = address(iss);
        BasqitFactory factory = new BasqitFactory(address(this), listed);
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(plain), 1e18);
        c[1] = BasqitToken.Component(address(iss), 1e18);
        basket = BasqitToken(factory.createBasket("Debt", "DEBT", c, 0));
        handler = new BasqitDebtHandler(basket, plain, iss);
        targetContract(address(handler));
    }

    /// A new deposit never lands in a basket that owes past redeemers more than it holds.
    function invariant_mintNeverCoversOldDebt() public view {
        assertFalse(handler.mintedIntoDeficit());
    }
}
