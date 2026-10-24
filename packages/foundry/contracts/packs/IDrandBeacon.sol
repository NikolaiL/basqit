// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDrandBeacon {
    function CHAIN_HASH() external view returns (bytes32);
    function PERIOD() external view returns (uint256);
    function GENESIS_TIME() external view returns (uint256);
    function roundAfter(uint256 time) external view returns (uint64);
    function publishTime(uint64 round) external view returns (uint256);
    function latestRound() external view returns (uint64);
    function randomness(uint64 round) external view returns (bytes32);
    function prove(uint64 round, bytes calldata signature) external returns (bytes32);
}
