// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Reference prices for the managed-basket rebalance guard.
interface IPriceReference {
    /// @notice USDG (6 decimals) per whole token (10**decimals units). Must revert or return 0 when the price is
    /// stale or the token is paused; the guard rejects 0.
    function priceUsdG(address token) external view returns (uint256);
}
