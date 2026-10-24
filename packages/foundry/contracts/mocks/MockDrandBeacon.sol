// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Unit tests only. Integration tests use real drand signatures and the deployed evmnet verifier.
contract MockDrandBeacon {
    bytes32 public constant CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    uint256 public constant PERIOD = 3;
    uint256 public constant GENESIS_TIME = 1727521075;
    mapping(uint64 => bytes32) public randomness;
    uint64 public latestRound;

    function roundAfter(uint256 time) external pure returns (uint64) {
        return uint64((time - GENESIS_TIME + 2) / 3 + 1);
    }

    function publishTime(uint64 round) external pure returns (uint256) {
        return GENESIS_TIME + (round - 1) * 3;
    }

    function prove(uint64 round, bytes calldata signature) external returns (bytes32 value) {
        require(signature.length == 32, "Invalid signature");
        value = abi.decode(signature, (bytes32));
        require(value != bytes32(0), "Invalid signature");
        if (randomness[round] != bytes32(0)) return randomness[round];
        randomness[round] = value;
        if (round > latestRound) latestRound = round;
    }
}
