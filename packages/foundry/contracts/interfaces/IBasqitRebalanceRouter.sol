// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Swaps a managed basket's sold components into its bought ones and returns everything to the basket.
interface IBasqitRebalanceRouter {
    /// @notice One exact-input swap; ignored for USDG, which needs no swap.
    struct Leg {
        address adapter;
        uint256 minAmountOut;
        bytes routeData;
    }

    /// @notice Pulls `sellAmounts` of `sellTokens` from the calling basket, sells each for USDG, splits the USDG by
    /// `buyBps` (summing to 10_000) and sends every bought token back to the basket.
    function rebalance(
        address[] calldata sellTokens,
        uint256[] calldata sellAmounts,
        address[] calldata buyTokens,
        uint16[] calldata buyBps,
        Leg[] calldata sellLegs,
        Leg[] calldata buyLegs
    ) external;
}
