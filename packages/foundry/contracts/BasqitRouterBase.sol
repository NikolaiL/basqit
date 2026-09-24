// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { BasqitFactory } from "./BasqitFactory.sol";

/// @notice Shared pieces of the Basqit routers: USDG, the factory, the adapter allowlist and creator fees.
abstract contract BasqitRouterBase is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice A newly allowed adapter can be used only after this delay, so users can see it coming.
    uint256 public constant ADAPTER_DELAY = 1 days;

    IERC20 public immutable usdG;
    BasqitFactory public immutable factory;

    mapping(address adapter => uint64) public adapterEnabledAt;
    /// @notice Fees that could not be paid out directly (e.g. the creator address was frozen).
    mapping(address creator => uint256) public claimableFees;

    event AdapterScheduled(address indexed adapter, bool allowed, uint64 effectiveAt);
    event CreatorFeePaid(address indexed basket, address indexed creator, uint256 amount, bool accrued);
    event FeesClaimed(address indexed creator, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error AdapterNotAllowed(address adapter);
    error InvalidRecipient(address recipient);
    error RenounceDisabled();

    /// @param initialAdapters usable immediately, so a fresh deployment works without waiting.
    constructor(address usdG_, address factory_, address initialOwner, address[] memory initialAdapters)
        Ownable(initialOwner)
    {
        if (usdG_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        usdG = IERC20(usdG_);
        factory = BasqitFactory(factory_);
        for (uint256 i = 0; i < initialAdapters.length; i++) {
            if (initialAdapters[i] == address(0)) revert ZeroAddress();
            adapterEnabledAt[initialAdapters[i]] = uint64(block.timestamp);
            emit AdapterScheduled(initialAdapters[i], true, uint64(block.timestamp));
        }
    }

    /// @notice Allowing takes effect after ADAPTER_DELAY; disallowing is immediate.
    function setAdapterAllowed(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (allowed && adapterEnabledAt[adapter] != 0) return; // already on or pending
        adapterEnabledAt[adapter] = allowed ? uint64(block.timestamp + ADAPTER_DELAY) : 0;
        emit AdapterScheduled(adapter, allowed, adapterEnabledAt[adapter]);
    }

    function allowedAdapters(address adapter) public view returns (bool) {
        uint64 at = adapterEnabledAt[adapter];
        return at != 0 && block.timestamp >= at;
    }

    function claimFees(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = claimableFees[msg.sender];
        if (amount == 0) revert ZeroAmount();
        claimableFees[msg.sender] = 0;
        usdG.safeTransfer(to, amount);
        emit FeesClaimed(msg.sender, to, amount);
    }

    /// @notice Disabled: without an owner a compromised adapter could never be switched off.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @dev Fee rounds up. It is sent to the creator right away, so routers do not pool fees that a
    /// USDG freeze could lock; if the transfer fails it is kept here for `claimFees`.
    function _chargeFee(address basket, uint256 amount) internal returns (uint256 fee, uint256 accrued) {
        (address creator, uint16 bps) = factory.creatorFee(basket);
        fee = Math.mulDiv(amount, bps, 10_000, Math.Rounding.Ceil);
        if (fee == 0) return (0, 0);
        if (!usdG.trySafeTransfer(creator, fee)) {
            accrued = fee;
            claimableFees[creator] += fee;
        }
        emit CreatorFeePaid(basket, creator, fee, accrued != 0);
    }

    function _checkRecipient(address recipient, address basket) internal view {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this) || recipient == basket) revert InvalidRecipient(recipient);
    }

    function _checkAdapter(address adapter) internal view {
        if (!allowedAdapters(adapter)) revert AdapterNotAllowed(adapter);
    }
}
