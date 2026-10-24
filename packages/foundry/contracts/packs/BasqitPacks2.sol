// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IDrandBeacon } from "./IDrandBeacon.sol";
import { Packs2Pricing } from "./Packs2Pricing.sol";

/// @notice Testnet prototype. Reusable 1,000-slot payout table, future drand evmnet round per opening,
/// permissionless reveal, then individual or batch claims. A shortage leaves the fixed claim pending until funded.
contract BasqitPacks2 is Ownable2StepUpgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint16 public constant SLOTS = 1000;
    uint16 public constant MAX_OPEN = 100;
    uint256 public constant ROUND_DELAY = 30 seconds;
    bytes32 public constant DRAND_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;

    /// @dev Exclusive upper bound: ends 500, 800, 1000 represent ranges 0-499, 500-799, 800-999.
    struct Tier {
        address token;
        uint128 amount;
        uint16 end;
    }

    struct Opening {
        address recipient;
        uint64 round;
        uint16 quantity;
        bool revealed;
        bytes32 seed;
        uint256 claimed;
    }

    struct Payout {
        address token;
        uint128 amount;
        uint16 slot;
        bool paid;
    }

    struct PackConfig {
        uint128 price;
        uint256 referencePriceUsdG;
        Tier[] tiers;
    }

    struct StockOption {
        address token;
        uint256 referencePriceUsdG;
        uint128[5] amounts;
    }

    // Append new state only; deployed proxies retain this layout across implementations.
    IERC20 public payToken;
    IDrandBeacon public beacon;
    uint128 public price;
    bool public opensPaused;
    uint256 public openingCount;
    Tier[] private _tiers;
    mapping(uint256 id => Opening) private _openings;
    mapping(address recipient => uint256[]) private _openingIds;
    mapping(address token => bool) public isPrizeToken;
    mapping(address token => uint256) public liabilities;

    Tier[] private _starterTiers;
    uint256 public starterFromOpening;
    uint256 public referencePriceUsdG;

    uint256 public configCount;
    mapping(uint256 configId => PackConfig) private _packConfigs;
    mapping(uint8 packType => uint256 configId) public currentConfigId;
    mapping(uint256 openingId => uint256 configId) public openingConfigId;
    mapping(uint256 configId => uint256[5]) private _packReferencePrices;
    mapping(uint256 configId => StockOption[]) private _stockPools;

    event OpenRequested(uint256 indexed id, address indexed recipient, uint16 quantity, uint64 round);
    event Revealed(uint256 indexed id, bytes32 seed);
    event Paid(uint256 indexed id, uint16 indexed pack, address indexed recipient, address token, uint256 amount);
    event Funded(address indexed token, address indexed from, uint256 amount);
    event OpensPaused(bool paused);
    event PaymentsWithdrawn(address indexed to, uint256 amount);
    event StarterConfigured(uint256 indexed firstOpening, uint256 referencePriceUsdG);
    event PackConfigured(uint8 indexed packType, uint256 indexed configId, uint128 price, uint256 referencePriceUsdG);
    event PackSelected(uint256 indexed id, uint8 indexed packType, uint256 indexed configId, uint128 price);

    error NotTestnet();
    error BadConfig();
    error BadQuantity();
    error BadOpening();
    error NotRevealed();
    error AlreadyRevealed();
    error AlreadyPaid();
    error NothingToCollect();
    error OpeningPaused();
    error RoundNotReady();
    error RoundAlreadyPublic();
    error UnsupportedToken();
    error ShortTransfer();
    error VaultShort(address token, uint256 required, uint256 available);
    error BadPackType();
    error ConfigChanged();
    error UsePackType();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address payment, address drand, uint128 price_, Tier[] calldata table)
        external
        initializer
        onlyProxy
    {
        if (block.chainid != 46630 && block.chainid != 31337) revert NotTestnet();
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        if (payment.code.length == 0 || drand.code.length == 0 || price_ == 0) revert BadConfig();
        if (table.length == 0 || table.length > 32) revert BadConfig();
        beacon = IDrandBeacon(drand);
        if (beacon.CHAIN_HASH() != DRAND_CHAIN_HASH || beacon.PERIOD() != 3 || beacon.GENESIS_TIME() != 1727521075) {
            revert BadConfig();
        }
        payToken = IERC20(payment);
        price = price_;
        uint16 previous;
        for (uint256 i; i < table.length; i++) {
            Tier memory t = table[i];
            if (t.token.code.length == 0 || t.token == payment || t.amount == 0 || t.end <= previous || t.end > SLOTS) {
                revert BadConfig();
            }
            _tiers.push(t);
            isPrizeToken[t.token] = true;
            previous = t.end;
        }
        if (previous != SLOTS) revert BadConfig();
    }

    function tiers() external view returns (Tier[] memory) {
        return starterFromOpening == 0 ? _tiers : _starterTiers;
    }

    /// @notice Configure future openings once; earlier openings retain the original payout table.
    function initializeStarter(uint256 referencePrice) external reinitializer(2) onlyOwner {
        address token = _tiers[0].token;
        for (uint256 i = 1; i < _tiers.length; i++) {
            if (_tiers[i].token != token) revert BadConfig();
        }
        uint128[5] memory amounts = Packs2Pricing.amounts(price, referencePrice);
        uint16[5] memory ends = [uint16(699), 922, 981, 998, 1000];
        for (uint256 i; i < 5; i++) {
            _starterTiers.push(Tier(token, amounts[i], ends[i]));
        }
        referencePriceUsdG = referencePrice;
        starterFromOpening = openingCount + 1;
        emit StarterConfigured(starterFromOpening, referencePrice);
    }

    function _authorizeUpgrade(address) internal override onlyOwner { }

    /// @notice Add three immutable configurations without changing any earlier opening's terms.
    function initializePackTypes(uint256 referencePrice) external reinitializer(3) onlyOwner onlyProxy {
        address token = _tiers[0].token;
        if (IERC20Metadata(address(payToken)).decimals() != 6 || IERC20Metadata(token).decimals() != 18) {
            revert BadConfig();
        }
        for (uint256 i = 1; i < _tiers.length; i++) {
            if (_tiers[i].token != token) revert BadConfig();
        }
        uint16[5] memory ends = [uint16(699), 922, 981, 998, 1000];
        for (uint8 packType = 1; packType <= 3; packType++) {
            uint256 configId = ++configCount;
            PackConfig storage config = _packConfigs[configId];
            config.price = uint128(1e6 * 10 ** (packType - 1));
            config.referencePriceUsdG = referencePrice;
            uint128[5] memory amounts = Packs2Pricing.amounts(config.price, referencePrice);
            for (uint256 i; i < 5; i++) {
                config.tiers.push(Tier(token, amounts[i], ends[i]));
            }
            currentConfigId[packType] = configId;
            emit PackConfigured(packType, configId, config.price, referencePrice);
        }
    }

    function packConfig(uint256 configId) external view returns (PackConfig memory) {
        if (_packConfigs[configId].price == 0) revert BadPackType();
        return _packConfigs[configId];
    }

    /// @notice New configurations use one stock per level; purchased configurations are never overwritten.
    function initializeMixedPackTypes(address[5] calldata tokens, uint256[5] calldata references)
        external
        reinitializer(4)
        onlyOwner
        onlyProxy
    {
        if (configCount == 0 || IERC20Metadata(address(payToken)).decimals() != 6) revert BadConfig();
        for (uint256 i; i < 5; i++) {
            if (
                tokens[i].code.length == 0 || tokens[i] == address(payToken)
                    || IERC20Metadata(tokens[i]).decimals() != 18
            ) {
                revert BadConfig();
            }
            for (uint256 j; j < i; j++) {
                if (tokens[i] == tokens[j]) revert BadConfig();
            }
            isPrizeToken[tokens[i]] = true;
        }
        uint16[5] memory ends = [uint16(699), 922, 981, 998, 1000];
        for (uint8 packType = 1; packType <= 3; packType++) {
            uint256 configId = ++configCount;
            PackConfig storage config = _packConfigs[configId];
            config.price = uint128(1e6 * 10 ** (packType - 1));
            for (uint256 i; i < 5; i++) {
                uint128[5] memory amounts = Packs2Pricing.amounts(config.price, references[i]);
                config.tiers.push(Tier(tokens[i], amounts[i], ends[i]));
            }
            _packReferencePrices[configId] = references;
            currentConfigId[packType] = configId;
            emit PackConfigured(packType, configId, config.price, 0);
        }
    }

    function packReferencePrices(uint256 configId) external view returns (uint256[5] memory) {
        if (_packConfigs[configId].price == 0) revert BadPackType();
        return _packReferencePrices[configId];
    }

    /// @notice Separate stock selection from payout level for future purchases only.
    function initializeStockSelection() external reinitializer(5) onlyOwner onlyProxy {
        uint256 sourceId = currentConfigId[1];
        uint256[5] memory references = _packReferencePrices[sourceId];
        if (references[0] == 0 || _packConfigs[sourceId].tiers.length != 5) revert BadConfig();
        for (uint8 packType = 1; packType <= 3; packType++) {
            PackConfig storage previous = _packConfigs[currentConfigId[packType]];
            uint256 configId = ++configCount;
            PackConfig storage config = _packConfigs[configId];
            config.price = previous.price;
            for (uint256 i; i < 5; i++) {
                // Representative tiers are display examples; the pool records every eligible payout.
                config.tiers.push(previous.tiers[i]);
                address token = _packConfigs[sourceId].tiers[i].token;
                uint128[5] memory amounts = Packs2Pricing.amounts(config.price, references[i]);
                _stockPools[configId].push(StockOption(token, references[i], amounts));
            }
            _packReferencePrices[configId] = references;
            currentConfigId[packType] = configId;
            emit PackConfigured(packType, configId, config.price, 0);
        }
    }

    function stockPool(uint256 configId) external view returns (StockOption[] memory) {
        if (_packConfigs[configId].price == 0) revert BadPackType();
        return _stockPools[configId];
    }

    /// @notice Revise future purchases to 70% Common and a 12.5x maximum; retain all purchased terms.
    function initializePayoutSchedule() external reinitializer(6) onlyOwner onlyProxy {
        uint16[5] memory ends = [uint16(700), 994, 997, 999, 1000];
        uint256[5] memory multiplesBps = [uint256(5000), 12500, 20000, 70000, 125000];
        _configurePayoutSchedule(ends, multiplesBps);
    }

    /// @notice Set future purchases to 80% calibrated return and a 12x maximum; retain purchased terms.
    function initializeEightyPercentPayouts() external reinitializer(7) onlyOwner onlyProxy {
        uint16[5] memory ends = [uint16(657), 970, 989, 999, 1000];
        uint256[5] memory multiplesBps = [uint256(5000), 12500, 17500, 35000, 120000];
        _configurePayoutSchedule(ends, multiplesBps);
    }

    function _configurePayoutSchedule(uint16[5] memory ends, uint256[5] memory multiplesBps) private {
        for (uint8 packType = 1; packType <= 3; packType++) {
            uint256 previousId = currentConfigId[packType];
            StockOption[] storage previous = _stockPools[previousId];
            if (previous.length != 5) revert BadConfig();
            uint256 configId = ++configCount;
            PackConfig storage config = _packConfigs[configId];
            config.price = _packConfigs[previousId].price;
            for (uint256 i; i < 5; i++) {
                StockOption storage stock = previous[i];
                uint128[5] memory amounts = Packs2Pricing.amounts(config.price, stock.referencePriceUsdG, multiplesBps);
                _stockPools[configId].push(StockOption(stock.token, stock.referencePriceUsdG, amounts));
                _packReferencePrices[configId][i] = stock.referencePriceUsdG;
                config.tiers.push(Tier(stock.token, amounts[i], ends[i]));
            }
            currentConfigId[packType] = configId;
            emit PackConfigured(packType, configId, config.price, 0);
        }
    }

    function openingTerms(uint256 id) external view returns (PackConfig memory) {
        if (_openings[id].recipient == address(0)) revert BadOpening();
        uint256 configId = openingConfigId[id];
        if (configId != 0) return _packConfigs[configId];
        bool starter = starterFromOpening != 0 && id >= starterFromOpening;
        return PackConfig(price, starter ? referencePriceUsdG : 0, starter ? _starterTiers : _tiers);
    }

    function opening(uint256 id) external view returns (Opening memory) {
        if (_openings[id].recipient == address(0)) revert BadOpening();
        return _openings[id];
    }

    /// @notice Newest first, with at most 50 openings per page.
    function openingIds(address recipient, uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        if (limit > 50) revert BadQuantity();
        uint256[] storage all = _openingIds[recipient];
        uint256 count = offset >= all.length ? 0 : all.length - offset;
        if (count > limit) count = limit;
        ids = new uint256[](count);
        for (uint256 i; i < count; i++) {
            ids[i] = all[all.length - 1 - offset - i];
        }
    }

    /// @notice Pay and commit the opening before its drand round exists. No inventory promise is made at entry.
    function open(uint16 quantity) external nonReentrant returns (uint256 id) {
        if (configCount != 0) revert UsePackType();
        return _open(quantity, price, 0);
    }

    function openPack(uint8 packType, uint16 quantity, uint256 expectedConfigId)
        external
        nonReentrant
        returns (uint256 id)
    {
        uint256 configId = currentConfigId[packType];
        if (configId == 0) revert BadPackType();
        if (configId != expectedConfigId) revert ConfigChanged();
        uint128 unitPrice = _packConfigs[configId].price;
        id = _open(quantity, unitPrice, configId);
        emit PackSelected(id, packType, configId, unitPrice);
    }

    function _open(uint16 quantity, uint128 unitPrice, uint256 configId) private returns (uint256 id) {
        if (opensPaused) revert OpeningPaused();
        if (quantity == 0 || quantity > MAX_OPEN) revert BadQuantity();
        // shortcut: the delay assumes a reasonably current L2 clock; review finality and clock bounds before mainnet.
        uint64 round = beacon.roundAfter(block.timestamp + ROUND_DELAY);
        if (round <= beacon.latestRound()) revert RoundAlreadyPublic();
        _pullExact(payToken, uint256(unitPrice) * quantity);
        id = ++openingCount;
        _openings[id] = Opening(msg.sender, round, quantity, false, bytes32(0), 0);
        _openingIds[msg.sender].push(id);
        if (configId != 0) openingConfigId[id] = configId;
        emit OpenRequested(id, msg.sender, quantity, round);
    }

    /// @notice Funding is never required to record a result. There is no replacement round or cancellation path.
    function reveal(uint256 id, bytes calldata signature) external nonReentrant {
        Opening storage o = _openings[id];
        if (o.recipient == address(0)) revert BadOpening();
        if (o.revealed) revert AlreadyRevealed();
        if (block.timestamp < beacon.publishTime(o.round)) revert RoundNotReady();
        bytes32 value = beacon.randomness(o.round);
        if (value == bytes32(0)) value = beacon.prove(o.round, signature);
        o.seed = keccak256(abi.encode(value, block.chainid, address(this), id));
        o.revealed = true;
        for (uint16 i; i < o.quantity; i++) {
            (Tier memory t,) = _outcome(o.seed, i, id);
            liabilities[t.token] += t.amount;
        }
        emit Revealed(id, o.seed);
    }

    function outcome(uint256 id, uint16 pack) external view returns (Tier memory tier, uint16 slot, bool paid) {
        Opening storage o = _revealedOpening(id, pack);
        (tier, slot) = _outcome(o.seed, pack, id);
        paid = o.claimed & (uint256(1) << pack) != 0;
    }

    function outcomes(uint256 id) external view returns (Payout[] memory results) {
        Opening storage o = _revealedOpening(id, 0);
        results = new Payout[](o.quantity);
        for (uint16 i; i < o.quantity; i++) {
            (Tier memory t, uint16 slot) = _outcome(o.seed, i, id);
            results[i] = Payout(t.token, t.amount, slot, o.claimed & (uint256(1) << i) != 0);
        }
    }

    /// @notice Anyone can pay gas, but the recorded recipient always receives the original token and amount.
    function claim(uint256 id, uint16 pack) external nonReentrant {
        Opening storage o = _revealedOpening(id, pack);
        uint256 bit = uint256(1) << pack;
        if (o.claimed & bit != 0) revert AlreadyPaid();
        (Tier memory t,) = _outcome(o.seed, pack, id);
        _pay(id, pack, o, t);
    }

    /// @notice Collect funded, unpaid packs in order; shortages keep their original outcomes pending.
    function claimAll(uint256 id) external nonReentrant {
        Opening storage o = _revealedOpening(id, 0);
        bool collected;
        for (uint16 pack; pack < o.quantity; pack++) {
            if (o.claimed & (uint256(1) << pack) != 0) continue;
            (Tier memory t,) = _outcome(o.seed, pack, id);
            if (IERC20(t.token).balanceOf(address(this)) < t.amount) continue;
            _pay(id, pack, o, t);
            collected = true;
        }
        if (!collected) revert NothingToCollect();
    }

    function _pay(uint256 id, uint16 pack, Opening storage o, Tier memory t) private {
        IERC20 token = IERC20(t.token);
        uint256 available = token.balanceOf(address(this));
        if (available < t.amount) revert VaultShort(t.token, t.amount, available);
        o.claimed |= uint256(1) << pack;
        liabilities[t.token] -= t.amount;
        uint256 beforeBalance = token.balanceOf(o.recipient);
        token.safeTransfer(o.recipient, t.amount);
        if (token.balanceOf(o.recipient) - beforeBalance != t.amount) revert ShortTransfer();
        emit Paid(id, pack, o.recipient, t.token, t.amount);
    }

    function fund(address token, uint256 amount) external nonReentrant {
        if (!isPrizeToken[token]) revert UnsupportedToken();
        if (amount == 0) revert BadQuantity();
        _pullExact(IERC20(token), amount);
        emit Funded(token, msg.sender, amount);
    }

    function setOpensPaused(bool paused) external onlyOwner {
        opensPaused = paused;
        emit OpensPaused(paused);
    }

    /// @notice Prize tokens cannot be withdrawn. Payment tokens are excluded from the configured prize table.
    function withdrawPayments(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadConfig();
        payToken.safeTransfer(to, amount);
        emit PaymentsWithdrawn(to, amount);
    }

    function _revealedOpening(uint256 id, uint16 pack) private view returns (Opening storage o) {
        o = _openings[id];
        if (o.recipient == address(0) || pack >= o.quantity) revert BadOpening();
        if (!o.revealed) revert NotRevealed();
    }

    function _outcome(bytes32 seed, uint16 pack, uint256 id) private view returns (Tier memory tier, uint16 slot) {
        uint256 value = uint256(keccak256(abi.encode(seed, pack)));
        uint256 limit = type(uint256).max - type(uint256).max % SLOTS;
        // Rejection sampling removes the tiny bias of reducing a 256-bit word directly modulo 1,000.
        while (value >= limit) value = uint256(keccak256(abi.encode(value)));
        slot = uint16(value % SLOTS);
        uint256 configId = openingConfigId[id];
        Tier[] storage table = configId != 0
            ? _packConfigs[configId].tiers
            : starterFromOpening != 0 && id >= starterFromOpening ? _starterTiers : _tiers;
        for (uint256 i; i < table.length; i++) {
            if (slot < table[i].end) {
                StockOption[] storage pool = _stockPools[configId];
                if (pool.length == 0) return (table[i], slot);
                uint256 stockValue = uint256(keccak256(abi.encode(seed, pack, bytes32("stock"))));
                uint256 stockLimit = type(uint256).max - type(uint256).max % pool.length;
                while (stockValue >= stockLimit) stockValue = uint256(keccak256(abi.encode(stockValue)));
                StockOption storage stock = pool[stockValue % pool.length];
                return (Tier(stock.token, stock.amounts[i], table[i].end), slot);
            }
        }
        revert BadConfig();
    }

    function _pullExact(IERC20 token, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert ShortTransfer();
    }
}
