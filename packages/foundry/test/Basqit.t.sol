// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../contracts/BasqitSellRouter.sol";
import { BasqitToken } from "../contracts/BasqitToken.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";
import { BasqitRouterBase } from "../contracts/BasqitRouterBase.sol";
import { UniswapV3Adapter } from "../contracts/adapters/UniswapV3Adapter.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Stock Token with the issuer powers seen onchain: pause, address block, admin burn, plus an
/// optional transfer fee to model a future upgrade.
contract IssuerToken is ERC20 {
    bool public paused;
    uint256 public feeBps;
    mapping(address => bool) public blocked;

    constructor() ERC20("Issuer", "ISS") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function setFeeBps(uint256 value) external {
        feeBps = value;
    }

    function adminBurn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(!paused, "paused");
            require(!blocked[from] && !blocked[to], "blocked");
            uint256 cut = value * feeBps / 10_000;
            if (cut > 0) {
                super._update(from, address(0), cut);
                value -= cut;
            }
        }
        super._update(from, to, value);
    }
}

/// @dev SwapRouter02 stand-in whose pool runs out of liquidity and takes only half the input.
contract HalfFillRouter {
    function exactInputSingle(UniswapV3AdapterParams calldata p) external returns (uint256) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn / 2);
        return 1;
    }
}

struct UniswapV3AdapterParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

contract BasqitTest is Test {
    MockUSDG internal usdG;
    MockStockToken internal tsla;
    MockStockToken internal nvda;
    MockStockToken internal unlisted;
    BasqitFactory internal factory;
    BasqitPurchaseRouter internal buyRouter;
    BasqitSellRouter internal sellRouter;
    TestnetSwapAdapter internal adapter;
    BasqitToken internal basket;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");

    // One share = 0.4 TSLA + 0.6 NVDA = 0.4 * 400 + 0.6 * 250 = 310 USDG at mock prices.
    uint256 internal constant TSLA_UNITS = 0.4e18;
    uint256 internal constant NVDA_UNITS = 0.6e18;
    uint256 internal constant SHARE_COST = 310e6;

    function setUp() public {
        usdG = new MockUSDG();
        tsla = new MockStockToken("Tesla", "TSLA");
        nvda = new MockStockToken("NVIDIA", "NVDA");
        unlisted = new MockStockToken("Unlisted", "NOPE");

        address[] memory listed = new address[](2);
        listed[0] = address(tsla);
        listed[1] = address(nvda);
        factory = new BasqitFactory(owner, listed);

        adapter = new TestnetSwapAdapter(address(usdG), address(this));
        adapter.setPrice(address(tsla), 400e6);
        adapter.setPrice(address(nvda), 250e6);
        tsla.mint(address(adapter), 1_000e18);
        nvda.mint(address(adapter), 1_000e18);
        usdG.mint(address(adapter), 1_000_000e6);

        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);
        buyRouter = new BasqitPurchaseRouter(address(usdG), address(factory), owner, adapters);
        sellRouter = new BasqitSellRouter(address(usdG), address(factory), owner, adapters);

        vm.prank(creator);
        basket = BasqitToken(factory.createBasket("Tech Duo", "DUO", _components(), 50));
        usdG.mint(alice, 10_000e6);
    }

    function _enableFees() internal {
        vm.prank(owner);
        factory.setFeesEnabled(true);
        vm.warp(block.timestamp + factory.FEE_CHANGE_DELAY());
    }

    function _components() internal view returns (BasqitToken.Component[] memory c) {
        c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(tsla), TSLA_UNITS);
        c[1] = BasqitToken.Component(address(nvda), NVDA_UNITS);
    }

    function _buySwaps(uint256 maxEach) internal view returns (BasqitPurchaseRouter.SwapInstruction[] memory s) {
        s = new BasqitPurchaseRouter.SwapInstruction[](2);
        s[0] = BasqitPurchaseRouter.SwapInstruction(address(adapter), maxEach, "");
        s[1] = BasqitPurchaseRouter.SwapInstruction(address(adapter), maxEach, "");
    }

    function _sellSwaps(uint256 minEach) internal view returns (BasqitSellRouter.SwapInstruction[] memory s) {
        s = new BasqitSellRouter.SwapInstruction[](2);
        s[0] = BasqitSellRouter.SwapInstruction(address(adapter), minEach, "");
        s[1] = BasqitSellRouter.SwapInstruction(address(adapter), minEach, "");
    }

    function _buy(uint256 shares, uint256 budget) internal returns (uint256 spent, uint256 fee, uint256 refunded) {
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), budget);
        (spent, fee, refunded) =
            buyRouter.buyBasket(address(basket), shares, budget, _buySwaps(budget), alice, block.timestamp);
        vm.stopPrank();
    }

    // --- BasqitToken ----------------------------------------------------------------------

    function test_token_mintAndRedeemInKind() public {
        tsla.mint(alice, 1e18);
        nvda.mint(alice, 1e18);
        vm.startPrank(alice);
        tsla.approve(address(basket), TSLA_UNITS);
        nvda.approve(address(basket), NVDA_UNITS);
        basket.mint(1e18, alice);
        assertEq(basket.balanceOf(alice), 1e18);
        assertEq(tsla.balanceOf(address(basket)), TSLA_UNITS);

        basket.redeem(1e18, alice);
        vm.stopPrank();
        assertEq(basket.totalSupply(), 0);
        assertEq(tsla.balanceOf(alice), 1e18);
        assertEq(nvda.balanceOf(alice), 1e18);
    }

    function test_token_roundsMintUpAndRedeemDown() public view {
        assertEq(basket.quoteMint(1)[0], 1); // 0.4 wei rounds up
        assertEq(basket.quoteRedeem(1)[0], 0); // and down on the way out
    }

    function test_token_rejectsBadComponents() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(tsla), 1);
        c[1] = BasqitToken.Component(address(tsla), 1);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.DuplicateToken.selector, address(tsla)));
        new BasqitToken("x", "x", c);

        c[1] = BasqitToken.Component(address(nvda), 0);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.ZeroUnits.selector, address(nvda)));
        new BasqitToken("x", "x", c);

        vm.expectRevert(BasqitToken.EmptyComponents.selector);
        new BasqitToken("x", "x", new BasqitToken.Component[](0));
    }

    function testFuzz_token_redeemNeverExceedsDeposit(uint96 shares) public {
        vm.assume(shares > 0);
        tsla.mint(alice, 1e30);
        nvda.mint(alice, 1e30);
        vm.startPrank(alice);
        tsla.approve(address(basket), type(uint256).max);
        nvda.approve(address(basket), type(uint256).max);
        basket.mint(shares, alice);
        basket.redeem(shares, alice);
        vm.stopPrank();
        assertEq(tsla.balanceOf(alice) + tsla.balanceOf(address(basket)), 1e30);
    }

    // --- BasqitFactory: registry ----------------------------------------------------------

    function test_factory_listsStockTokensAtDeploy() public view {
        assertTrue(factory.isStockToken(address(tsla)));
        assertTrue(factory.isStockToken(address(nvda)));
        assertEq(factory.stockTokenCount(), 2);
    }

    function test_factory_rejectsUnlistedComponent() public {
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(unlisted), 1e18);
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.UnlistedToken.selector, address(unlisted)));
        factory.createBasket("x", "x", c, 0);
    }

    function test_factory_ownerListsAndDelistsTokens() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(unlisted);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        factory.listStockTokens(tokens);

        vm.prank(owner);
        factory.listStockTokens(tokens);
        assertTrue(factory.isStockToken(address(unlisted)));

        vm.prank(owner);
        factory.delistStockTokens(tokens);
        assertFalse(factory.isStockToken(address(unlisted)));

        // Listing again restores it without duplicating the list entry.
        vm.prank(owner);
        factory.listStockTokens(tokens);
        assertEq(factory.stockTokenCount(), 3);
    }

    function test_factory_delistedComponentBlocksBuysButNotSells() public {
        _buy(1e18, 400e6);
        address[] memory tokens = new address[](1);
        tokens[0] = address(tsla);
        vm.prank(owner);
        factory.delistStockTokens(tokens);

        vm.startPrank(alice);
        usdG.approve(address(buyRouter), 400e6);
        vm.expectRevert(abi.encodeWithSelector(BasqitPurchaseRouter.DelistedComponent.selector, address(tsla)));
        buyRouter.buyBasket(address(basket), 1e18, 400e6, _buySwaps(400e6), alice, block.timestamp);

        basket.approve(address(sellRouter), 1e18);
        sellRouter.sellBasket(address(basket), 1e18, 0, _sellSwaps(0), alice, block.timestamp);
        vm.stopPrank();
        assertEq(basket.balanceOf(alice), 0, "holders can still exit");
    }

    // --- BasqitFactory: creator fees ------------------------------------------------------

    function test_factory_recordsCreatorAndFee() public view {
        assertTrue(factory.isBasket(address(basket)));
        assertEq(factory.creatorOf(address(basket)), creator);
        (uint16 current,,) = factory.feeSchedule(address(basket));
        assertEq(current, 50);
    }

    function test_factory_feeSwitchWaitsForDelayButTurnsOffAtOnce() public {
        (, uint16 bps) = factory.creatorFee(address(basket));
        assertEq(bps, 0);
        vm.prank(owner);
        factory.setFeesEnabled(true);
        (, bps) = factory.creatorFee(address(basket));
        assertEq(bps, 0, "switching on is announced, not instant");

        vm.warp(block.timestamp + factory.FEE_CHANGE_DELAY());
        (, bps) = factory.creatorFee(address(basket));
        assertEq(bps, 50);

        vm.prank(owner);
        factory.setFeesEnabled(false);
        (, bps) = factory.creatorFee(address(basket));
        assertEq(bps, 0, "switching off is immediate");
    }

    function test_ownershipCannotBeRenounced() public {
        vm.startPrank(owner);
        vm.expectRevert(BasqitFactory.RenounceDisabled.selector);
        factory.renounceOwnership();
        vm.expectRevert(BasqitRouterBase.RenounceDisabled.selector);
        buyRouter.renounceOwnership();
        vm.stopPrank();
    }

    function test_router_newAdapterWaitsForDelayButDisablesAtOnce() public {
        address newAdapter = makeAddr("newAdapter");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        buyRouter.setAdapterAllowed(newAdapter, true);

        vm.prank(owner);
        buyRouter.setAdapterAllowed(newAdapter, true);
        assertFalse(buyRouter.allowedAdapters(newAdapter));
        vm.warp(block.timestamp + buyRouter.ADAPTER_DELAY());
        assertTrue(buyRouter.allowedAdapters(newAdapter));

        vm.prank(owner);
        buyRouter.setAdapterAllowed(address(adapter), false);
        assertFalse(buyRouter.allowedAdapters(address(adapter)));
    }

    function test_factory_capsCreatorFee() public {
        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.FeeTooHigh.selector, uint16(101)));
        factory.createBasket("x", "x", _components(), 101);
    }

    function test_factory_feeChangeWaitsForDelay() public {
        _enableFees();

        vm.expectRevert(abi.encodeWithSelector(BasqitFactory.NotCreator.selector, address(basket)));
        factory.scheduleCreatorFee(address(basket), 100);

        vm.prank(creator);
        factory.scheduleCreatorFee(address(basket), 100);
        (, uint16 bps) = factory.creatorFee(address(basket));
        assertEq(bps, 50, "old fee until the delay passes");

        vm.warp(block.timestamp + factory.FEE_CHANGE_DELAY());
        (, bps) = factory.creatorFee(address(basket));
        assertEq(bps, 100);
    }

    // --- Purchase router ------------------------------------------------------------------

    function test_buy_mintsSharesAndRefundsUnusedUsdG() public {
        uint256 before = usdG.balanceOf(alice);
        (uint256 spent, uint256 fee, uint256 refunded) = _buy(1e18, 400e6);
        assertEq(spent, SHARE_COST);
        assertEq(fee, 0, "fees are off by default");
        assertEq(refunded, 90e6);
        assertEq(usdG.balanceOf(alice), before - SHARE_COST);
        assertEq(basket.balanceOf(alice), 1e18);
        assertEq(usdG.balanceOf(address(buyRouter)), 0);
        assertEq(tsla.balanceOf(address(buyRouter)), 0);
    }

    function test_buy_paysCreatorFeeDirectly() public {
        _enableFees();
        (uint256 spent, uint256 fee,) = _buy(1e18, 400e6);
        assertEq(fee, spent * 50 / 10_000);
        assertEq(usdG.balanceOf(creator), fee, "paid straight to the creator");
        assertEq(usdG.balanceOf(address(buyRouter)), 0, "router pools nothing");
        assertEq(buyRouter.claimableFees(creator), 0);
    }

    function test_fee_roundsUp() public {
        _enableFees();
        (, uint256 fee,) = _buy(3e12, 400e6); // spends 930 wei of USDG; 0.5% is 4.65 wei
        assertEq(fee, 5);
    }

    function test_buy_revertsWhenFeeDoesNotFitBudget() public {
        _enableFees();
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), SHARE_COST);
        vm.expectRevert(
            abi.encodeWithSelector(
                BasqitPurchaseRouter.TotalSpendExceeded.selector, SHARE_COST + SHARE_COST * 50 / 10_000, SHARE_COST
            )
        );
        buyRouter.buyBasket(address(basket), 1e18, SHARE_COST, _buySwaps(SHARE_COST), alice, block.timestamp);
        vm.stopPrank();
    }

    function test_buy_revertsOnPerLegLimit() public {
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), 400e6);
        vm.expectRevert(abi.encodeWithSelector(TestnetSwapAdapter.ExcessiveInput.selector, 160e6, 100e6));
        buyRouter.buyBasket(address(basket), 1e18, 400e6, _buySwaps(100e6), alice, block.timestamp);
        vm.stopPrank();
    }

    function test_buy_rejectsUnknownBasketAdapterAndDeadline() public {
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), 400e6);
        vm.expectRevert(abi.encodeWithSelector(BasqitPurchaseRouter.BasketNotRegistered.selector, address(tsla)));
        buyRouter.buyBasket(address(tsla), 1e18, 400e6, _buySwaps(400e6), alice, block.timestamp);

        BasqitPurchaseRouter.SwapInstruction[] memory swaps = _buySwaps(400e6);
        swaps[1].adapter = alice;
        vm.expectRevert(abi.encodeWithSelector(BasqitRouterBase.AdapterNotAllowed.selector, alice));
        buyRouter.buyBasket(address(basket), 1e18, 400e6, swaps, alice, block.timestamp);

        vm.expectRevert(abi.encodeWithSelector(BasqitPurchaseRouter.DeadlineExpired.selector, block.timestamp - 1));
        buyRouter.buyBasket(address(basket), 1e18, 400e6, _buySwaps(400e6), alice, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_buy_rejectsRouterOrBasketAsRecipient() public {
        vm.startPrank(alice);
        usdG.approve(address(buyRouter), 400e6);
        vm.expectRevert(abi.encodeWithSelector(BasqitRouterBase.InvalidRecipient.selector, address(buyRouter)));
        buyRouter.buyBasket(address(basket), 1e18, 400e6, _buySwaps(400e6), address(buyRouter), block.timestamp);
        vm.stopPrank();
    }

    function test_buy_donatedTokensCannotBlockPurchases() public {
        tsla.mint(address(buyRouter), 1);
        usdG.mint(address(buyRouter), 1);
        _buy(1e18, 400e6);
        assertEq(basket.balanceOf(alice), 1e18);
    }

    // --- Sell router ----------------------------------------------------------------------

    function test_sell_redeemsAndPaysUsdG() public {
        _buy(1e18, 400e6);
        uint256 before = usdG.balanceOf(alice);
        vm.startPrank(alice);
        basket.approve(address(sellRouter), 1e18);
        (uint256 paid, uint256 fee) =
            sellRouter.sellBasket(address(basket), 1e18, SHARE_COST, _sellSwaps(0), alice, block.timestamp);
        vm.stopPrank();
        assertEq(paid, SHARE_COST);
        assertEq(fee, 0);
        assertEq(usdG.balanceOf(alice), before + SHARE_COST);
        assertEq(basket.totalSupply(), 0);
        assertEq(tsla.balanceOf(address(sellRouter)), 0);
    }

    function test_sell_paysFeeAndChecksMinimumAfterFee() public {
        _buy(1e18, 400e6);
        _enableFees();
        uint256 fee = SHARE_COST * 50 / 10_000;

        vm.startPrank(alice);
        basket.approve(address(sellRouter), 1e18);
        vm.expectRevert(
            abi.encodeWithSelector(BasqitSellRouter.TotalOutputBelowMinimum.selector, SHARE_COST - fee, SHARE_COST)
        );
        sellRouter.sellBasket(address(basket), 1e18, SHARE_COST, _sellSwaps(0), alice, block.timestamp);

        (uint256 paid, uint256 charged) =
            sellRouter.sellBasket(address(basket), 1e18, SHARE_COST - fee, _sellSwaps(0), alice, block.timestamp);
        vm.stopPrank();
        assertEq(charged, fee);
        assertEq(paid, SHARE_COST - fee);
        assertEq(usdG.balanceOf(creator), fee);
    }

    function test_sell_revertsWhenOneLegMissesMinimum() public {
        _buy(1e18, 400e6);
        BasqitSellRouter.SwapInstruction[] memory swaps = _sellSwaps(0);
        swaps[1].minAmountOut = 151e6; // NVDA leg pays exactly 150
        vm.startPrank(alice);
        basket.approve(address(sellRouter), 1e18);
        vm.expectRevert(abi.encodeWithSelector(TestnetSwapAdapter.InsufficientOutput.selector, 150e6, 151e6));
        sellRouter.sellBasket(address(basket), 1e18, 0, swaps, alice, block.timestamp);
        vm.stopPrank();
        assertEq(basket.balanceOf(alice), 1e18, "whole sale reverted");
    }

    // --- Issuer and venue risks ---------------------------------------------------------------

    /// Basket of one plain token and one issuer token, 1 unit each per share, 10 shares for alice.
    function _issuerBasket() internal returns (BasqitToken b, IssuerToken iss) {
        iss = new IssuerToken();
        address[] memory tokens = new address[](1);
        tokens[0] = address(iss);
        vm.prank(owner);
        factory.listStockTokens(tokens);
        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        c[1] = BasqitToken.Component(address(iss), 1e18);
        b = BasqitToken(factory.createBasket("Issuer mix", "MIX", c, 0));
        tsla.mint(alice, 20e18);
        iss.mint(alice, 20e18);
        vm.startPrank(alice);
        tsla.approve(address(b), type(uint256).max);
        iss.approve(address(b), type(uint256).max);
        b.mint(10e18, alice);
        vm.stopPrank();
    }

    function test_pausedComponent_redeemAvailableStillReturnsTheRest() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.setPaused(true);

        vm.startPrank(alice);
        vm.expectRevert(bytes("paused"));
        b.redeem(10e18, alice);

        uint256 tslaBefore = tsla.balanceOf(alice);
        b.redeemAvailable(10e18, alice);
        assertEq(tsla.balanceOf(alice) - tslaBefore, 10e18, "unaffected component paid now");
        assertEq(b.owed(alice, address(iss)), 10e18, "paused component recorded as owed");

        vm.expectRevert(bytes("paused"));
        b.claimOwed(address(iss), alice);
        vm.stopPrank();

        iss.setPaused(false);
        vm.prank(alice);
        b.claimOwed(address(iss), alice);
        assertEq(iss.balanceOf(alice), 20e18);
        assertEq(b.totalOwed(address(iss)), 0);
    }

    function test_blockedBasket_holdersStillGetOtherComponents() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.setBlocked(address(b), true);
        vm.prank(alice);
        b.redeemAvailable(4e18, alice);
        assertEq(b.owed(alice, address(iss)), 4e18);
        assertEq(tsla.balanceOf(address(b)), 6e18);
    }

    function test_owedTokensDoNotBackRemainingShares() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.setPaused(true);
        vm.prank(alice);
        b.redeemAvailable(4e18, alice);
        iss.setPaused(false);
        assertTrue(b.isFullyBacked());
        assertEq(b.quoteRedeem(6e18)[1], 6e18, "remaining shares still get their full amount");
    }

    function test_issuerBurn_shortfallIsSharedProRata() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        vm.prank(alice);
        b.transfer(creator, 5e18);
        iss.adminBurn(address(b), 5e18); // half the issuer token is gone
        assertFalse(b.isFullyBacked());

        vm.prank(alice);
        b.redeem(5e18, alice);
        vm.prank(creator);
        b.redeem(5e18, creator);
        assertEq(iss.balanceOf(creator), 2.5e18, "last redeemer gets the same share as the first");
        assertEq(iss.balanceOf(alice), 10e18 + 2.5e18);
    }

    function test_issuerBurn_blocksMintUntilWhole() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.adminBurn(address(b), 5e18);
        vm.prank(alice);
        vm.expectRevert(BasqitToken.UnderBacked.selector);
        b.mint(1e18, alice);
        iss.mint(address(b), 5e18); // the issuer makes the basket whole again
        assertTrue(b.isFullyBacked());
        vm.prank(alice);
        b.mint(1e18, alice);
    }

    /// Supply 0 with unpaid owed debt: a new deposit must not be able to cover the old deficit.
    function test_issuerBurn_owedDeficitBlocksMintAtZeroSupply() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.setPaused(true);
        vm.prank(alice);
        b.redeemAvailable(10e18, alice); // supply 0, 10 iss owed
        iss.setPaused(false);
        iss.adminBurn(address(b), 6e18); // balance 4 < owed 10
        assertEq(b.totalSupply(), 0);
        assertFalse(b.isFullyBacked());
        vm.prank(alice);
        vm.expectRevert(BasqitToken.UnderBacked.selector);
        b.mint(10e18, alice);
    }

    function test_feeOnTransferComponent_mintReverts() public {
        (BasqitToken b, IssuerToken iss) = _issuerBasket();
        iss.setFeeBps(100);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasqitToken.ShortDelivery.selector, address(iss), 0.99e18, 1e18));
        b.mint(1e18, alice);
    }

    function test_fee_accruesWhenCreatorCannotReceive() public {
        IssuerToken usdX = new IssuerToken(); // stands in for a freezable USDG
        TestnetSwapAdapter venue = new TestnetSwapAdapter(address(usdX), address(this));
        venue.setPrice(address(tsla), 400e6);
        tsla.mint(address(venue), 100e18);
        address[] memory adapters = new address[](1);
        adapters[0] = address(venue);
        BasqitPurchaseRouter router = new BasqitPurchaseRouter(address(usdX), address(factory), owner, adapters);
        BasqitToken.Component[] memory c = new BasqitToken.Component[](1);
        c[0] = BasqitToken.Component(address(tsla), 1e18);
        vm.prank(creator);
        address b = factory.createBasket("One", "ONE", c, 100);
        _enableFees();

        usdX.setBlocked(creator, true);
        usdX.mint(alice, 1_000e6);
        BasqitPurchaseRouter.SwapInstruction[] memory swaps = new BasqitPurchaseRouter.SwapInstruction[](1);
        swaps[0] = BasqitPurchaseRouter.SwapInstruction(address(venue), 500e6, "");
        vm.startPrank(alice);
        usdX.approve(address(router), 500e6);
        (, uint256 fee,) = router.buyBasket(b, 1e18, 500e6, swaps, alice, block.timestamp);
        vm.stopPrank();

        assertEq(fee, 4e6);
        assertEq(router.claimableFees(creator), fee, "kept for later instead of blocking the buy");
        assertEq(usdX.balanceOf(address(router)), fee);
        vm.prank(creator);
        router.claimFees(makeAddr("creatorVault"));
        assertEq(usdX.balanceOf(makeAddr("creatorVault")), fee);
    }

    function test_uniswapAdapter_revertsOnPartialFill() public {
        HalfFillRouter pool = new HalfFillRouter();
        UniswapV3Adapter uni = new UniswapV3Adapter(address(pool));
        tsla.mint(alice, 10e18);
        vm.startPrank(alice);
        tsla.approve(address(uni), 10e18);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3Adapter.PartialFill.selector, 5e18));
        uni.swapExactInput(address(tsla), address(usdG), 10e18, 0, alice, abi.encode(uint24(500)));
        vm.stopPrank();
    }

    function test_sell_dustThatRedeemsToNothingReverts() public {
        _buy(1e18, 400e6);
        vm.startPrank(alice);
        basket.approve(address(sellRouter), 1);
        vm.expectRevert(BasqitRouterBase.ZeroAmount.selector);
        sellRouter.sellBasket(address(basket), 1, 0, _sellSwaps(0), alice, block.timestamp);
        vm.stopPrank();
    }

    function test_testnetAdapterRefusesRobinhoodChain() public {
        vm.chainId(4663);
        vm.expectRevert(TestnetSwapAdapter.NotTestnet.selector);
        new TestnetSwapAdapter(address(usdG), address(this));
    }
}
