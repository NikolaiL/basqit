// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/*
 .------------------------------------------------------------------------------------------------------.
 | ```````````````````````````````````````````````````````````````````````````````````````````````````` |
 | `````````````````````````:####````````````````````````````````````````````````:####`:``````````````` |
 | `####################````:####````````````````````````````````````````````````:####`:``+##:````````` |
 | `###::::::::::::::+##````:####`:+#+:``````++###+:`````:++##++:`````++#+:`:+++``++++``:+###+++``````` |
 | `+##`````````+#+``##+````:###########```+#########``:#########+```######+####`:####``########``````` |
 | `:##:`````##:###``##:````:#####:+####+`:####:`+###+`+###+``####``+####::#####`:####``:####+::``````` |
 | ``##+`:+::##:###`+##`````:####```#####``++++:+#####`:#######+:```####+``:####`:####```####:````````` |
 | ``###`:++:##:###`###`````:####```+####``+##########```:+######+``####+``:####`:####```####:````````` |
 | ``+##``:``:+`:+:`##+`````:####:``####+`+###+``+####`+###:`:####+`#####``#####`:####```####+````+++:` |
 | ``:##+::::::::::+##:`````:###+#######``############`:####++####:`:###########`:####```+######`#####` |
 | ```:##############+``````:###::####+````+####+`####``:+######+:```:####+:####``####````+#####`:###+` |
 | ````````````````````````````````````````````````````````````````````````:####``````````````````````` |
 | ````````````````````````````````````````````````````````````````````````:####``````````````````````` |
 | ```Build a basket. Send a gift. Open a pack.```````````````````````````````````````````````````````` |
 '------------------------------------------------------------------------------------------------------'
*/

interface IDiceConsumer {
    function _entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) external;
}

/// @notice Test double for DiceEntropy: exact fee, sequence numbers, callback, withholding and fee refunds.
contract MockDiceEntropy {
    error LocalOnly();

    /// @dev Anyone can reveal, so anyone could pick a seed: it must never exist outside the local chain.
    constructor() {
        if (block.chainid != 31337) revert LocalOnly();
    }

    address public constant PROVIDER = address(0xD1CE);
    uint128 public fee = 25_000_000_000_000;

    struct Pending {
        address requester;
        uint128 paid;
        bool open;
    }

    uint64 public nextSequence = 1;
    mapping(uint64 sequence => Pending) public pending;

    error WrongFee(uint256 sent, uint256 expected);
    error NotRequester();
    error NotOpen();

    function getDefaultProvider() external pure returns (address) {
        return PROVIDER;
    }

    function getFeeV2(address, uint32) external view returns (uint128) {
        return fee;
    }

    function requestV2(address, bytes32, uint32) external payable returns (uint64 sequence) {
        if (msg.value != fee) revert WrongFee(msg.value, fee);
        sequence = nextSequence++;
        pending[sequence] = Pending(msg.sender, uint128(msg.value), true);
    }

    /// @dev Test hook: the provider reveals and the consumer is called back.
    function reveal(uint64 sequence, bytes32 randomNumber) external {
        Pending memory request = pending[sequence];
        if (!request.open) revert NotOpen();
        delete pending[sequence];
        IDiceConsumer(request.requester)._entropyCallback(sequence, PROVIDER, randomNumber);
    }

    function refundRequest(address, uint64 sequence) external {
        Pending memory request = pending[sequence];
        if (!request.open) revert NotOpen();
        if (request.requester != msg.sender) revert NotRequester();
        delete pending[sequence];
        (bool ok,) = msg.sender.call{ value: request.paid }("");
        require(ok, "refund failed");
    }
}
