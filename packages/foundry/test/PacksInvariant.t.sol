// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { BasqitPacks } from "../contracts/packs/BasqitPacks.sol";
import { MockDiceEntropy } from "../contracts/mocks/MockDiceEntropy.sol";
import { MockUSDG } from "../contracts/mocks/MockUSDG.sol";
import { MockStockToken } from "../contracts/mocks/MockStockToken.sol";

/// Drives rounds through every path: sales, draws, reveals, withheld reveals, cancels, claims and refunds.
contract PacksHandler is Test {
    BasqitPacks public packs;
    MockDiceEntropy public dice;
    MockUSDG public usdg;
    MockStockToken public nvda;
    address[3] buyers = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    uint256 public constant PRICE = 1e6;

    constructor(BasqitPacks packs_, MockDiceEntropy dice_, MockUSDG usdg_, MockStockToken nvda_) {
        packs = packs_;
        dice = dice_;
        usdg = usdg_;
        nvda = nvda_;
        for (uint256 i = 0; i < buyers.length; i++) {
            usdg.mint(buyers[i], 1e12);
            vm.prank(buyers[i]);
            usdg.approve(address(packs), type(uint256).max);
        }
        vm.deal(address(this), 100 ether);
    }

    function startNext() external {
        if (packs.roundCount() >= 8) return;
        uint256 last = packs.roundCount();
        if (last != 0) {
            BasqitPacks.Status s = packs.getRound(last).status;
            if (s != BasqitPacks.Status.Finalized && s != BasqitPacks.Status.Cancelled) return;
        }
        BasqitPacks.Prize[] memory prizes = packs.templatePrizes();
        if (prizes.length == 0) return;
        uint256 needed; // every template prize here is nvda
        for (uint256 i = 0; i < prizes.length; i++) {
            needed += prizes[i].amount;
        }
        if (packs.reserve(address(nvda)) < needed) return;
        packs.startNextRound();
    }

    /// Owner-side paths: top up, withdraw unused reserve, and switch the template off and on.
    function ownerReserve(uint96 amount, bool withdraw) external {
        address owner = packs.owner();
        vm.startPrank(owner);
        if (withdraw) {
            uint256 take = bound(amount, 0, packs.reserve(address(nvda)));
            if (take > 0) packs.withdrawReserve(address(nvda), take, owner);
        } else {
            uint256 add = bound(amount, 1, 1e17);
            packs.fundReserve(address(nvda), add);
        }
        vm.stopPrank();
    }

    function ownerTemplate(bool clear, uint8 rawSize) external {
        vm.startPrank(packs.owner());
        if (clear) {
            packs.clearTemplate();
        } else {
            uint256 size = bound(rawSize, 1, 10);
            BasqitPacks.Prize[] memory prizes = new BasqitPacks.Prize[](size);
            for (uint256 i = 0; i < size; i++) {
                prizes[i] = BasqitPacks.Prize(address(nvda), (i + 1) * 1e15);
            }
            packs.setTemplate(address(usdg), PRICE, prizes, 1 days, 1 hours);
        }
        vm.stopPrank();
    }

    function buy(uint256 rawRound, uint8 rawCount, uint8 who) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        BasqitPacks.Round memory r = packs.getRound(roundId);
        if (r.status != BasqitPacks.Status.Selling || block.timestamp > r.saleDeadline) return;
        uint256 left = r.size - packs.ownersOf(roundId).length;
        uint256 count = bound(rawCount, 1, left);
        address buyer = buyers[who % buyers.length];
        vm.prank(buyer);
        packs.buy(roundId, count, buyer);
    }

    function draw(uint256 rawRound) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        BasqitPacks.Round memory r = packs.getRound(roundId);
        if (r.status != BasqitPacks.Status.SoldOut || block.timestamp > r.closedAt + r.drawTimeout) return;
        packs.requestDraw{ value: packs.drawFee() }(roundId);
    }

    function reveal(uint256 rawRound, bytes32 word) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        BasqitPacks.Round memory r = packs.getRound(roundId);
        (,, bool open) = dice.pending(r.sequence);
        if (r.sequence == 0 || !open) return;
        dice.reveal(r.sequence, word);
    }

    function finalize(uint256 rawRound) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0 || packs.getRound(roundId).status != BasqitPacks.Status.Seeded) return;
        packs.finalize(roundId);
    }

    function warp(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1, 2 days));
    }

    function cancel(uint256 rawRound) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        try packs.cancel(roundId) { } catch { }
    }

    function settle(uint256 rawRound, uint8 rawPack) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        uint256 sold = packs.ownersOf(roundId).length;
        if (sold == 0) return;
        uint256 packId = rawPack % sold;
        if (packs.settled(roundId, packId)) return;
        BasqitPacks.Status status = packs.getRound(roundId).status;
        if (status == BasqitPacks.Status.Finalized) packs.claim(roundId, packId);
        else if (status == BasqitPacks.Status.Cancelled) packs.refund(roundId, packId);
    }

    function ownerTakesProceeds(uint256 rawRound) external {
        uint256 roundId = _round(rawRound);
        if (roundId == 0) return;
        BasqitPacks.Round memory r = packs.getRound(roundId);
        if (r.status != BasqitPacks.Status.Finalized || r.proceedsTaken) return;
        address owner = packs.owner();
        vm.prank(owner);
        packs.withdrawProceeds(roundId, owner);
    }

    function _round(uint256 raw) internal view returns (uint256) {
        uint256 count = packs.roundCount();
        return count == 0 ? 0 : (raw % count) + 1;
    }

    receive() external payable { }
}

contract PacksInvariantTest is Test {
    BasqitPacks packs;
    MockUSDG usdg;
    MockStockToken nvda;
    PacksHandler handler;

    function setUp() public {
        MockDiceEntropy dice = new MockDiceEntropy();
        usdg = new MockUSDG();
        nvda = new MockStockToken("Mock NVDA", "NVDA");
        address creator = makeAddr("creator");
        packs = new BasqitPacks(creator, address(dice));
        nvda.mint(creator, 1e30);
        vm.startPrank(creator);
        nvda.approve(address(packs), type(uint256).max);
        BasqitPacks.Prize[] memory prizes = new BasqitPacks.Prize[](5);
        for (uint256 i = 0; i < 5; i++) {
            prizes[i] = BasqitPacks.Prize(address(nvda), (i + 1) * 1e15);
        }
        packs.setTemplate(address(usdg), 1e6, prizes, 1 days, 1 hours);
        packs.fundReserve(address(nvda), 1e18);
        vm.stopPrank();
        handler = new PacksHandler(packs, dice, usdg, nvda);
        targetContract(address(handler));
    }

    /// The contract always holds every unpaid prize and every unrefunded or unwithdrawn payment.
    function invariant_EscrowCoversEveryObligation() public view {
        uint256 prizesOwed;
        uint256 paymentsOwed;
        for (uint256 roundId = 1; roundId <= packs.roundCount(); roundId++) {
            BasqitPacks.Round memory r = packs.getRound(roundId);
            BasqitPacks.Prize[] memory prizes = packs.prizesOf(roundId);
            uint256 sold = packs.ownersOf(roundId).length;
            bytes memory order = packs.assignmentOf(roundId);
            if (r.status == BasqitPacks.Status.Cancelled) {
                // Its prizes are back in the reserve; only the buyers' payments are still owed.
                for (uint256 p = 0; p < sold; p++) {
                    if (!packs.settled(roundId, p)) paymentsOwed += r.price;
                }
            } else if (r.status == BasqitPacks.Status.Finalized) {
                for (uint256 p = 0; p < sold; p++) {
                    if (!packs.settled(roundId, p)) prizesOwed += prizes[uint8(order[p])].amount;
                }
                if (!r.proceedsTaken) paymentsOwed += r.price * sold;
            } else {
                for (uint256 i = 0; i < prizes.length; i++) {
                    prizesOwed += prizes[i].amount;
                }
                paymentsOwed += r.price * sold;
            }
        }
        assertEq(nvda.balanceOf(address(packs)), prizesOwed + packs.reserve(address(nvda)), "prize escrow + reserve");
        assertEq(usdg.balanceOf(address(packs)), paymentsOwed, "payment escrow");
    }

    /// One round at a time: every round before the latest is finalized or cancelled.
    function invariant_OneLiveRound() public view {
        for (uint256 roundId = 1; roundId < packs.roundCount(); roundId++) {
            BasqitPacks.Status s = packs.getRound(roundId).status;
            assertTrue(s == BasqitPacks.Status.Finalized || s == BasqitPacks.Status.Cancelled, "one live round");
        }
    }

    /// A finalized round's assignment is always a permutation of its prize slots.
    function invariant_FinalizedAssignmentIsPermutation() public view {
        for (uint256 roundId = 1; roundId <= packs.roundCount(); roundId++) {
            bytes memory order = packs.assignmentOf(roundId);
            if (order.length == 0) continue;
            bool[] memory seen = new bool[](order.length);
            for (uint256 i = 0; i < order.length; i++) {
                uint256 slot = uint8(order[i]);
                assertFalse(seen[slot], "slot assigned twice");
                seen[slot] = true;
            }
        }
    }
}
