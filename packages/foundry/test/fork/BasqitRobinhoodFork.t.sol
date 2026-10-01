// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BasqitFactory } from "../../contracts/BasqitFactory.sol";
import { BasqitPurchaseRouter } from "../../contracts/BasqitPurchaseRouter.sol";
import { BasqitSellRouter } from "../../contracts/BasqitSellRouter.sol";
import { BasqitToken } from "../../contracts/BasqitToken.sol";
import { UniswapV3Adapter } from "../../contracts/adapters/UniswapV3Adapter.sol";

/// @notice Buys and sells a real NVDA + AAPL basket through Uniswap v3 on a fork of Robinhood Chain.
/// Run with: ROBINHOOD_RPC_URL=<rpc> forge test --match-path test/fork/*
contract BasqitRobinhoodForkTest is Test {
    // Verified on chain 4663: Robinhood asset list (tokens), Uniswap docs (router), pool scan (pools).
    IERC20 internal constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant SWAP_ROUTER_02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    // MSFT/USDG pool: a USDG holder for funding the test wallet; MSFT is not traded here.
    address internal constant USDG_HOLDER = 0xeb60bCD1D920ad6E102690CCFC6fB488899E1510;
    uint24 internal constant FEE_TIER = 500;

    BasqitFactory internal factory;
    BasqitPurchaseRouter internal buyRouter;
    BasqitSellRouter internal sellRouter;
    UniswapV3Adapter internal adapter;
    BasqitToken internal basket;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        address[] memory listed = new address[](2);
        listed[0] = NVDA;
        listed[1] = AAPL;
        factory = new BasqitFactory(owner, address(USDG), listed, address(0));
        adapter = new UniswapV3Adapter(SWAP_ROUTER_02);
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);
        buyRouter = new BasqitPurchaseRouter(address(USDG), address(factory), owner, adapters);
        sellRouter = new BasqitSellRouter(address(USDG), address(factory), owner, adapters);
        vm.prank(owner);
        factory.setFeesEnabled(true);
        vm.warp(block.timestamp + factory.FEE_CHANGE_DELAY());

        BasqitToken.Component[] memory c = new BasqitToken.Component[](2);
        c[0] = BasqitToken.Component(NVDA, 0.01e18);
        c[1] = BasqitToken.Component(AAPL, 0.01e18);
        vm.prank(creator);
        basket = BasqitToken(factory.createBasket("AI Duo", "AIDUO", c, 50, BasqitFactory.Management(false, 0, 0)));

        vm.prank(USDG_HOLDER);
        USDG.transfer(alice, 100e6);
    }

    function test_fork_buyAndSellRealBasket() public {
        BasqitPurchaseRouter.SwapInstruction[] memory buys = new BasqitPurchaseRouter.SwapInstruction[](2);
        buys[0] = BasqitPurchaseRouter.SwapInstruction(address(adapter), 20e6, abi.encode(FEE_TIER));
        buys[1] = BasqitPurchaseRouter.SwapInstruction(address(adapter), 20e6, abi.encode(FEE_TIER));

        vm.startPrank(alice);
        USDG.approve(address(buyRouter), 40e6);
        (uint256 spent, uint256 buyFee, uint256 refunded) =
            buyRouter.buyBasket(address(basket), 1e18, 40e6, buys, alice, block.timestamp);
        vm.stopPrank();

        assertEq(basket.balanceOf(alice), 1e18);
        assertEq(IERC20(NVDA).balanceOf(address(basket)), 0.01e18);
        assertEq(IERC20(AAPL).balanceOf(address(basket)), 0.01e18);
        assertEq(spent + buyFee + refunded, 40e6);
        assertEq(buyFee, (spent * 50 + 9999) / 10_000, "fee rounds up");
        assertEq(USDG.balanceOf(address(adapter)), 0, "adapter keeps nothing");
        emit log_named_decimal_uint("basket cost, USDG", spent, 6);

        BasqitSellRouter.SwapInstruction[] memory sells = new BasqitSellRouter.SwapInstruction[](2);
        sells[0] = BasqitSellRouter.SwapInstruction(address(adapter), 1, abi.encode(FEE_TIER));
        sells[1] = BasqitSellRouter.SwapInstruction(address(adapter), 1, abi.encode(FEE_TIER));
        vm.startPrank(alice);
        basket.approve(address(sellRouter), 1e18);
        (uint256 paid, uint256 sellFee) =
            sellRouter.sellBasket(address(basket), 1e18, spent * 95 / 100, sells, alice, block.timestamp);
        vm.stopPrank();

        emit log_named_decimal_uint("paid back, USDG", paid, 6);
        assertEq(basket.totalSupply(), 0);
        assertGt(paid, spent * 95 / 100, "round trip loses only pool fees and fees");
        assertEq(USDG.balanceOf(creator), buyFee + sellFee, "fees paid straight to the creator");
        assertEq(USDG.balanceOf(address(buyRouter)) + USDG.balanceOf(address(sellRouter)), 0);
    }
}
