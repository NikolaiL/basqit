// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library Packs2Pricing {
    error BadReferencePrice();

    /// @notice USDG and the reference price use six decimals; prize tokens use eighteen.
    function amounts(uint128 price, uint256 referencePriceUsdG) internal pure returns (uint128[5] memory result) {
        uint256[5] memory multiplesBps = [uint256(3500), 10000, 20000, 70000, 226750];
        return amounts(price, referencePriceUsdG, multiplesBps);
    }

    function amounts(uint128 price, uint256 referencePriceUsdG, uint256[5] memory multiplesBps)
        internal
        pure
        returns (uint128[5] memory result)
    {
        if (referencePriceUsdG == 0) revert BadReferencePrice();
        for (uint256 i; i < 5; i++) {
            uint256 amount = uint256(price) * multiplesBps[i] * 1e18 / (referencePriceUsdG * 10000);
            if (amount == 0 || amount > type(uint128).max) revert BadReferencePrice();
            result[i] = uint128(amount);
        }
    }
}
