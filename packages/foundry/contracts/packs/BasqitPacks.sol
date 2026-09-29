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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IDiceEntropy } from "./IDiceEntropy.sol";

/// @notice Packs, testnet design. The owner sets a template and funds a prize reserve; once the latest round is
/// done, anyone starts the next one, which moves its prizes from the reserve into escrow before the first sale.
/// A round sells a fixed number of packs at one price; one round runs at a time. When the round sells out, one Dice Protocol request
/// (https://diceprotocol.world) returns a random word, and a shuffle derived from it assigns exactly one
/// prize slot to each pack. Anyone can recompute the assignment from the stored seed.
///
/// Dice is a commit-reveal oracle with one provider, not a VRF. The provider's value is fixed by its hash chain,
/// so the provider can know the outcome before revealing and choose to withhold it. It can also steer it without
/// anything showing on-chain: by advancing its sequence with other requests before `requestDraw`, or together
/// with the last buyer, by trying recipient addresses offline. A round that is not revealed in time is cancelled,
/// every buyer is refunded and its prizes go back to the reserve; there is never a second draw of that round, and a
/// withheld reveal switches the template off. The provider is Dice's
/// default at request time. Testnet only: public packs need a VRF or several providers, and a legal review.
contract BasqitPacks is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PACKS = 100;
    /// @notice The callback only stores the seed (~35k gas); the shuffle runs later in `finalize`. Same flat fee.
    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;
    /// @notice Far above Dice's usual 1-3 s reveal and its ~6 L1-block refund delay; bounded so funds cannot lock.
    uint64 public constant MIN_DRAW_TIMEOUT = 1 hours;
    uint64 public constant MAX_DRAW_TIMEOUT = 7 days;
    uint64 public constant MAX_SALE_DURATION = 30 days;

    enum Status {
        None,
        Selling,
        SoldOut,
        Drawing,
        Seeded,
        Finalized,
        Cancelled
    }

    struct Prize {
        address token;
        uint256 amount;
    }

    struct Round {
        IERC20 payToken;
        uint256 price;
        uint64 saleDeadline;
        uint64 drawTimeout;
        uint64 closedAt;
        uint64 requestedAt;
        uint64 sequence;
        address provider;
        address feePayer;
        uint16 size;
        Status status;
        bool proceedsTaken;
        bytes32 seed;
        /// @dev Running hash of every purchase, fixed at sell-out; the Dice user contribution. Nobody picks it.
        bytes32 salesHash;
    }

    /// @notice Settings for the rounds anyone can start with `startNextRound`, funded from `reserve`.
    struct Template {
        address payToken;
        uint256 price;
        uint64 saleDuration;
        uint64 drawTimeout;
    }

    IDiceEntropy public immutable entropy;
    uint256 public roundCount;
    Template public template;
    Prize[] private _templatePrizes;
    /// @notice Prize tokens the owner set aside for future rounds, not yet in any round.
    mapping(address token => uint256) public reserve;

    mapping(uint256 roundId => Round) private _rounds;
    mapping(uint256 roundId => Prize[]) private _prizes;
    mapping(uint256 roundId => address[]) private _owners;
    /// @dev Pack `i` receives prize slot `uint8(_assignment[roundId][i])`.
    mapping(uint256 roundId => bytes) private _assignment;
    mapping(uint256 roundId => mapping(uint256 packId => bool)) public settled;
    /// @dev Keyed by provider and sequence: Dice sequence numbers are counted per provider.
    mapping(bytes32 providerSequence => uint256 roundId) public roundOfRequest;

    event RoundCreated(uint256 indexed roundId, address payToken, uint256 price, uint256 size);
    event PacksBought(
        uint256 indexed roundId, address indexed buyer, address indexed recipient, uint256 firstPackId, uint256 count
    );
    event DrawRequested(uint256 indexed roundId, uint64 sequence, address provider);
    event RoundSeeded(uint256 indexed roundId, bytes32 seed);
    event RoundFinalized(uint256 indexed roundId);
    event PrizeClaimed(uint256 indexed roundId, uint256 indexed packId, address indexed owner, uint256 slot);
    event RoundCancelled(uint256 indexed roundId);
    event PackRefunded(uint256 indexed roundId, uint256 indexed packId, address indexed owner, uint256 amount);
    event PrizesReturned(uint256 indexed roundId);
    event ProceedsWithdrawn(uint256 indexed roundId, address to, uint256 amount);
    event DiceFeeRefunded(uint256 indexed roundId, address indexed to, uint256 amount);
    event TemplateSet(address payToken, uint256 price, uint256 size);
    event DrawTimeoutSet(uint64 drawTimeout);
    event ReserveFunded(address indexed token, uint256 amount);
    event ReserveWithdrawn(address indexed token, address to, uint256 amount);

    error ZeroAddress();
    error BadRoundSize(uint256 size);
    error BadDuration();
    error PriceTooHigh();
    error NotPackOwner(uint256 packId);
    error ZeroAmount();
    error WrongStatus(Status actual);
    error SaleClosed();
    error NotEnoughPacks(uint256 left);
    error ShortDelivery(address token, uint256 received, uint256 expected);
    error WrongFee(uint256 sent, uint256 expected);
    error OnlyEntropy();
    error NotCancellable();
    error AlreadySettled(uint256 packId);
    error NoFeeToRefund();
    error EthTransferFailed();
    error RenounceDisabled();
    error NotTestnet();
    error NoTemplate();
    error RoundInProgress(uint256 roundId);
    error InsufficientReserve(address token, uint256 needed, uint256 available);

    constructor(address initialOwner, address entropy_) Ownable(initialOwner) {
        if (block.chainid != 46630 && block.chainid != 31337) revert NotTestnet();
        if (entropy_ == address(0)) revert ZeroAddress();
        entropy = IDiceEntropy(entropy_);
    }

    // ---------------------------------------------------------------- create and sell

    /// @notice Sets the round anyone can start once the previous one is done. Prizes come from `reserve`; rounds
    /// already open keep their own terms.
    function setTemplate(
        address payToken,
        uint256 price,
        Prize[] calldata prizes,
        uint64 saleDuration,
        uint64 drawTimeout
    ) external onlyOwner {
        _validate(payToken, price, prizes, saleDuration, drawTimeout);
        template = Template(payToken, price, saleDuration, drawTimeout);
        delete _templatePrizes;
        for (uint256 i = 0; i < prizes.length; i++) {
            _templatePrizes.push(prizes[i]);
        }
        emit TemplateSet(payToken, price, prizes.length);
    }

    /// @notice Changes how long future template rounds wait for Dice before they can be cancelled and refunded.
    /// Rounds already open keep the timeout they started with, so buyers' refund window never moves under them.
    function setDrawTimeout(uint64 drawTimeout) external onlyOwner {
        if (drawTimeout < MIN_DRAW_TIMEOUT || drawTimeout > MAX_DRAW_TIMEOUT) revert BadDuration();
        if (_templatePrizes.length == 0) revert NoTemplate();
        template.drawTimeout = drawTimeout;
        emit DrawTimeoutSet(drawTimeout);
    }

    /// @notice Stops `startNextRound`. Clear first, then change prizes or withdraw the reserve, so nobody can
    /// open one more round on the old terms in between.
    function clearTemplate() external onlyOwner {
        delete template;
        delete _templatePrizes;
        emit TemplateSet(address(0), 0, 0);
    }

    function fundReserve(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(IERC20(token), msg.sender, amount);
        reserve[token] += amount;
        emit ReserveFunded(token, amount);
    }

    /// @notice Takes back unused reserve only; prizes already in a round are never touched.
    function withdrawReserve(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        if (amount > reserve[token]) revert InsufficientReserve(token, amount, reserve[token]);
        reserve[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit ReserveWithdrawn(token, to, amount);
    }

    /// @notice Anyone can open the next round from the template once the latest round is finalized or cancelled.
    /// Its prizes move from the reserve into the round's escrow.
    function startNextRound() external nonReentrant returns (uint256 roundId) {
        Prize[] memory prizes = _templatePrizes;
        if (prizes.length == 0) revert NoTemplate();
        uint256 last = roundCount;
        if (last != 0) {
            Status status = _rounds[last].status;
            if (status != Status.Finalized && status != Status.Cancelled) revert RoundInProgress(last);
        }
        for (uint256 i = 0; i < prizes.length; i++) {
            uint256 available = reserve[prizes[i].token];
            if (available < prizes[i].amount) revert InsufficientReserve(prizes[i].token, prizes[i].amount, available);
            reserve[prizes[i].token] = available - prizes[i].amount;
        }
        Template memory t = template;
        roundId = ++roundCount;
        Round storage round = _rounds[roundId];
        round.payToken = IERC20(t.payToken);
        round.price = t.price;
        round.saleDeadline = uint64(block.timestamp) + t.saleDuration;
        round.drawTimeout = t.drawTimeout;
        round.size = uint16(prizes.length);
        round.status = Status.Selling;
        for (uint256 i = 0; i < prizes.length; i++) {
            _prizes[roundId].push(prizes[i]);
        }
        emit RoundCreated(roundId, t.payToken, t.price, prizes.length);
    }

    function _validate(
        address payToken,
        uint256 price,
        Prize[] calldata prizes,
        uint64 saleDuration,
        uint64 drawTimeout
    ) private pure {
        if (payToken == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroAmount();
        if (price > type(uint256).max / MAX_PACKS) revert PriceTooHigh();
        if (saleDuration == 0 || saleDuration > MAX_SALE_DURATION) revert BadDuration();
        if (drawTimeout < MIN_DRAW_TIMEOUT || drawTimeout > MAX_DRAW_TIMEOUT) revert BadDuration();
        if (prizes.length == 0 || prizes.length > MAX_PACKS) revert BadRoundSize(prizes.length);
        for (uint256 i = 0; i < prizes.length; i++) {
            if (prizes[i].token == address(0)) revert ZeroAddress();
            if (prizes[i].amount == 0) revert ZeroAmount();
        }
    }

    function templatePrizes() external view returns (Prize[] memory) {
        return _templatePrizes;
    }

    /// @notice Buys `count` packs for `recipient`. The last pack sold closes the round.
    function buy(uint256 roundId, uint256 count, address recipient) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Selling) revert WrongStatus(round.status);
        if (block.timestamp > round.saleDeadline) revert SaleClosed();
        if (recipient == address(0) || recipient == address(this)) revert ZeroAddress();
        if (count == 0) revert ZeroAmount();
        address[] storage owners = _owners[roundId];
        uint256 left = round.size - owners.length;
        if (count > left) revert NotEnoughPacks(left);

        _pull(round.payToken, msg.sender, round.price * count);
        uint256 first = owners.length;
        for (uint256 i = 0; i < count; i++) {
            owners.push(recipient);
        }
        round.salesHash = keccak256(abi.encode(round.salesHash, msg.sender, recipient, first, count, block.timestamp));
        if (owners.length == round.size) {
            round.status = Status.SoldOut;
            round.closedAt = uint64(block.timestamp);
        }
        emit PacksBought(roundId, msg.sender, recipient, first, count);
    }

    // ---------------------------------------------------------------- draw

    /// @notice Anyone can start the draw once a round sells out, paying Dice's exact fee. One request per round.
    function requestDraw(uint256 roundId) external payable nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.status != Status.SoldOut) revert WrongStatus(round.status);
        if (block.timestamp > uint256(round.closedAt) + round.drawTimeout) revert SaleClosed();
        address provider = entropy.getDefaultProvider();
        uint256 fee = entropy.getFeeV2(provider, CALLBACK_GAS_LIMIT);
        if (msg.value != fee) revert WrongFee(msg.value, fee);

        round.status = Status.Drawing;
        round.provider = provider;
        round.feePayer = msg.sender;
        round.requestedAt = uint64(block.timestamp);
        // Fixed by the purchases themselves, so whoever calls this has nothing to choose or grind.
        bytes32 userRandom = keccak256(abi.encode(round.salesHash, block.chainid, address(this), roundId));
        uint64 sequence = entropy.requestV2{ value: fee }(provider, userRandom, CALLBACK_GAS_LIMIT);
        round.sequence = sequence;
        roundOfRequest[_requestKey(provider, sequence)] = roundId;
        emit DrawRequested(roundId, sequence, provider);
    }

    /// @notice Dice calls this with the revealed word. Only stores the seed. Foreign reveals, and reveals arriving
    /// after the draw timeout (when the round can already be cancelled), are ignored rather than reverted: at any
    /// moment only one of "seed" or "cancel" is possible, never a race between them.
    function _entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) external {
        if (msg.sender != address(entropy)) revert OnlyEntropy();
        uint256 roundId = roundOfRequest[_requestKey(provider, sequence)];
        if (roundId == 0) return;
        Round storage round = _rounds[roundId];
        if (round.status != Status.Drawing || round.sequence != sequence || round.provider != provider) return;
        if (block.timestamp > uint256(round.requestedAt) + round.drawTimeout) return;
        // Domain-separated so the same word can never be replayed into another round or deployment.
        bytes32 seed = keccak256(abi.encode(randomNumber, block.chainid, address(this), roundId));
        round.seed = seed;
        round.status = Status.Seeded;
        emit RoundSeeded(roundId, seed);
    }

    /// @notice Anyone can turn the stored seed into the pack-to-prize assignment. Deterministic, run once.
    function finalize(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Seeded) revert WrongStatus(round.status);
        _assignment[roundId] = shuffle(round.seed, round.size);
        round.status = Status.Finalized;
        emit RoundFinalized(roundId);
    }

    /// @notice Fisher-Yates over slots 0..size-1, drawing each index with rejection sampling so it is unbiased.
    function shuffle(bytes32 seed, uint256 size) public pure returns (bytes memory order) {
        order = new bytes(size);
        for (uint256 i = 0; i < size; i++) {
            order[i] = bytes1(uint8(i));
        }
        uint256 nonce;
        for (uint256 i = size; i > 1; i--) {
            uint256 j;
            (j, nonce) = _uniform(seed, nonce, i);
            (order[i - 1], order[j]) = (order[j], order[i - 1]);
        }
    }

    function _uniform(bytes32 seed, uint256 nonce, uint256 range) private pure returns (uint256, uint256) {
        uint256 limit = type(uint256).max - (type(uint256).max % range);
        while (true) {
            uint256 word = uint256(keccak256(abi.encode(seed, nonce++)));
            if (word < limit) return (word % range, nonce);
        }
        return (0, nonce); // unreachable
    }

    // ---------------------------------------------------------------- settle

    /// @notice Pays a pack's prize to the pack's owner. Anyone may call; the recipient is fixed.
    function claim(uint256 roundId, uint256 packId) external nonReentrant {
        _claim(roundId, packId, _owners[roundId][packId]);
    }

    /// @notice The pack's owner sends its prize elsewhere, e.g. if their own address is frozen by the token.
    function claimTo(uint256 roundId, uint256 packId, address to) external nonReentrant {
        if (_owners[roundId][packId] != msg.sender) revert NotPackOwner(packId);
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        _claim(roundId, packId, to);
    }

    function _claim(uint256 roundId, uint256 packId, address to) private {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Finalized) revert WrongStatus(round.status);
        if (settled[roundId][packId]) revert AlreadySettled(packId);
        settled[roundId][packId] = true;
        uint256 slot = uint8(_assignment[roundId][packId]);
        Prize memory prize = _prizes[roundId][slot];
        IERC20(prize.token).safeTransfer(to, prize.amount);
        emit PrizeClaimed(roundId, packId, to, slot);
    }

    /// @notice Cancels a round that can no longer finish: unsold at its deadline, or not revealed in time.
    function cancel(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        bool expired = (round.status == Status.Selling && block.timestamp > round.saleDeadline)
            || (round.status == Status.SoldOut && block.timestamp > uint256(round.closedAt) + round.drawTimeout)
            || (round.status == Status.Drawing && block.timestamp > uint256(round.requestedAt) + round.drawTimeout);
        if (!expired) revert NotCancellable();
        bool withheld = round.status == Status.Drawing;
        round.status = Status.Cancelled;
        emit RoundCancelled(roundId);
        // A withheld reveal switches the template off, so the same prizes are not re-offered for another try.
        if (withheld) {
            delete template;
            delete _templatePrizes;
            emit TemplateSet(address(0), 0, 0);
        }
        // The prizes go back to the reserve, so unsold rounds never drain it; the owner withdraws unused reserve.
        Prize[] storage prizes = _prizes[roundId];
        for (uint256 slot = 0; slot < prizes.length; slot++) {
            reserve[prizes[slot].token] += prizes[slot].amount;
        }
        emit PrizesReturned(roundId);
    }

    /// @notice Refunds one pack of a cancelled round to its owner. Anyone may call; the recipient is fixed.
    function refund(uint256 roundId, uint256 packId) external nonReentrant {
        _refund(roundId, packId, _owners[roundId][packId]);
    }

    /// @notice The pack's owner sends its refund elsewhere, e.g. if their own address is frozen by the token.
    function refundTo(uint256 roundId, uint256 packId, address to) external nonReentrant {
        if (_owners[roundId][packId] != msg.sender) revert NotPackOwner(packId);
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        _refund(roundId, packId, to);
    }

    function _refund(uint256 roundId, uint256 packId, address to) private {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Cancelled) revert WrongStatus(round.status);
        if (settled[roundId][packId]) revert AlreadySettled(packId);
        settled[roundId][packId] = true;
        round.payToken.safeTransfer(to, round.price);
        emit PackRefunded(roundId, packId, to, round.price);
    }

    /// @notice The owner takes the sales once the draw is final, never before: refunds stay possible until then.
    function withdrawProceeds(uint256 roundId, address to) external onlyOwner nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Finalized) revert WrongStatus(round.status);
        if (round.proceedsTaken) revert AlreadySettled(type(uint256).max);
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        round.proceedsTaken = true;
        uint256 amount = round.price * round.size;
        round.payToken.safeTransfer(to, amount);
        emit ProceedsWithdrawn(roundId, to, amount);
    }

    /// @notice After a cancelled draw, reclaims Dice's fee (after its refund delay) for whoever paid it.
    function refundDiceFee(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.status != Status.Cancelled) revert WrongStatus(round.status);
        address payer = round.feePayer;
        if (payer == address(0)) revert NoFeeToRefund();
        round.feePayer = address(0);
        uint256 before = address(this).balance;
        entropy.refundRequest(round.provider, round.sequence);
        uint256 amount = address(this).balance - before;
        (bool ok,) = payer.call{ value: amount }("");
        if (!ok) revert EthTransferFailed();
        emit DiceFeeRefunded(roundId, payer, amount);
    }

    /// @dev Only Dice refunds arrive here.
    receive() external payable {
        if (msg.sender != address(entropy)) revert OnlyEntropy();
    }

    /// @notice Disabled: the template, the reserve and the sales need an owner, and ownership should never be lost
    /// by accident.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- views

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function prizesOf(uint256 roundId) external view returns (Prize[] memory) {
        return _prizes[roundId];
    }

    function ownersOf(uint256 roundId) external view returns (address[] memory) {
        return _owners[roundId];
    }

    /// @notice Prize slot for every pack, once finalized (empty before).
    function assignmentOf(uint256 roundId) external view returns (bytes memory) {
        return _assignment[roundId];
    }

    function drawFee() external view returns (uint256) {
        return entropy.getFeeV2(entropy.getDefaultProvider(), CALLBACK_GAS_LIMIT);
    }

    function _requestKey(address provider, uint64 sequence) private pure returns (bytes32) {
        return keccak256(abi.encode(provider, sequence));
    }

    function _pull(IERC20 token, address from, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert ShortDelivery(address(token), received, amount);
    }
}
