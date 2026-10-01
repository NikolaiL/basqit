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

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC4906 } from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The token list gifts accept: the basket factory's allowed tokens, so gifts and baskets never disagree.
interface IStockTokenList {
    function isAllowedToken(address token) external view returns (bool);
}

/// @notice Gifts: a sealed gift of Stock Tokens as an ERC-721. Anyone seals listed tokens they hold into a gift
/// for someone (`wrap`); buying the tokens first is a router's job (`BasqitGiftRouter`), so new ways to pay can
/// be added without touching gifts already sealed. Opening burns the gift and sends its tokens to whoever holds it.
contract BasqitGifts is ERC721, IERC4906, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ITEMS = 10;
    /// @dev Gift picture: a purple pack with a torn top and a wrapped box; the gift number goes between the halves.
    string private constant _SVG_HEAD =
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600' width='600' height='600'><defs><pattern id='d' width='24' height='24' patternUnits='userSpaceOnUse'><circle cx='4' cy='4' r='2' fill='#c9c3f3'/></pattern></defs><rect width='600' height='600' fill='#efecfd'/><rect width='600' height='600' fill='url(#d)'/><g transform='rotate(-4 300 300)'><path d='M130,110 L140,92 L150,110 L160,92 L170,110 L180,92 L190,110 L200,92 L210,110 L220,92 L230,110 L240,92 L250,110 L260,92 L270,110 L280,92 L290,110 L300,92 L310,110 L320,92 L330,110 L340,92 L350,110 L360,92 L370,110 L380,92 L390,110 L400,92 L410,110 L420,92 L430,110 L440,92 L450,110 L460,92 L470,110 L470,486 Q470,510 446,510 L154,510 Q130,510 130,486 Z' transform='translate(0 10)' fill='#2f2787'/><path d='M130,110 L140,92 L150,110 L160,92 L170,110 L180,92 L190,110 L200,92 L210,110 L220,92 L230,110 L240,92 L250,110 L260,92 L270,110 L280,92 L290,110 L300,92 L310,110 L320,92 L330,110 L340,92 L350,110 L360,92 L370,110 L380,92 L390,110 L400,92 L410,110 L420,92 L430,110 L440,92 L450,110 L460,92 L470,110 L470,486 Q470,510 446,510 L154,510 Q130,510 130,486 Z' fill='#5a4fe0'/><g transform='translate(0 -6)'><rect x='222' y='232' width='156' height='104' rx='12' fill='#fff'/><rect x='210' y='200' width='180' height='42' rx='10' fill='#fff'/><rect x='210' y='236' width='180' height='6' fill='#dcd8fb'/><rect x='289' y='200' width='22' height='136' fill='#ffb020'/><path d='M300,198 C270,150 228,166 246,194 C256,208 284,204 300,198 Z' fill='#ffb020'/><path d='M300,198 C330,150 372,166 354,194 C344,208 316,204 300,198 Z' fill='#ffb020'/><circle cx='300' cy='198' r='13' fill='#e89a0c'/><path d='M190,160 Q190,176 206,176 Q190,176 190,192 Q190,176 174,176 Q190,176 190,160 Z' fill='#ffb020'/><path d='M412,224 Q412,236 424,236 Q412,236 412,248 Q412,236 400,236 Q412,236 412,224 Z' fill='#fff'/><path d='M404,152 Q404,160 412,160 Q404,160 404,168 Q404,160 396,160 Q404,160 404,152 Z' fill='#fff'/><path d='M186,291 Q186,300 195,300 Q186,300 186,309 Q186,300 177,300 Q186,300 186,291 Z' fill='#fff'/></g><text x='300' y='412' text-anchor='middle' font-family='Bricolage Grotesque, Arial Black, Helvetica, sans-serif' font-weight='800' font-size='58' fill='#fff'>Gift #";
    string private constant _SVG_TAIL =
        "</text><text x='300' y='450' text-anchor='middle' font-family='Bricolage Grotesque, Helvetica, Arial, sans-serif' font-weight='700' font-size='19' fill='#fff' fill-opacity='0.85'>Sealed. Open to see inside.</text><text x='300' y='486' text-anchor='middle' font-family='IBM Plex Mono, Menlo, monospace' font-size='17' fill='#fff' fill-opacity='0.7'>basqit. gift</text></g></svg>";

    struct Item {
        address token;
        uint256 amount;
    }

    uint256 public giftCount;
    /// @notice Only tokens on this list go into a gift, so a gift never holds an unknown token.
    IStockTokenList public immutable stockTokens;
    mapping(uint256 giftId => Item[]) private _contents;
    /// @notice Gift contents that could not be delivered on open (token paused or holder frozen), claimable later.
    mapping(address holder => mapping(address token => uint256)) public owed;
    /// @notice Pictures the owner offers, by id from 1; an empty entry has been withdrawn. Id 0 is the built-in picture.
    string[] private _designs;
    /// @notice The picture each gift shows; 0, or a withdrawn design, shows the built-in picture.
    mapping(uint256 giftId => uint256 designId) public designOf;
    /// @notice Whether holders may pick a picture from the list for their own gift.
    bool public designChoiceOpen;

    event GiftWrapped(uint256 indexed giftId, address indexed sender, address indexed recipient);
    event GiftOpened(uint256 indexed giftId, address indexed holder);
    event ItemOwed(address indexed holder, address indexed token, uint256 amount);
    event OwedClaimed(address indexed holder, address indexed token, address to, uint256 amount);
    event DesignSet(uint256 indexed designId, string imageUri);
    event DesignChoiceOpened(bool open);
    event DesignChosen(uint256 indexed giftId, uint256 indexed designId);

    error ZeroAddress();
    error ZeroAmount();
    error BadItems(uint256 count);
    error DuplicateToken(address token);
    error NotListed(address token);
    error NotHolder(uint256 giftId);
    error ShortDelivery(address token, uint256 received, uint256 expected);
    error BadDesign(uint256 designId);
    error DesignChoiceClosed();
    error BadImageUri();
    error InvalidRecipient(address recipient);
    error RenounceDisabled();

    constructor(address initialOwner, address stockTokens_) ERC721("Basqit Gift", "BQGIFT") Ownable(initialOwner) {
        if (stockTokens_ == address(0)) revert ZeroAddress();
        stockTokens = IStockTokenList(stockTokens_);
    }

    /// @notice Whether new gifts may hold `token`. Gifts already sealed still open after a token is delisted.
    function isListed(address token) public view returns (bool) {
        return stockTokens.isAllowedToken(token);
    }

    // ---------------------------------------------------------------- wrap and open

    /// @notice Seals listed tokens the caller holds into a gift for `recipient`, who can be someone else.
    function wrap(Item[] calldata items, address recipient) external nonReentrant returns (uint256 giftId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this)) revert InvalidRecipient(recipient);
        if (items.length == 0 || items.length > MAX_ITEMS) revert BadItems(items.length);
        giftId = ++giftCount;
        for (uint256 i = 0; i < items.length; i++) {
            Item calldata item = items[i];
            if (!isListed(item.token)) revert NotListed(item.token);
            if (item.amount == 0) revert ZeroAmount();
            for (uint256 j = 0; j < i; j++) {
                if (items[j].token == item.token) revert DuplicateToken(item.token);
            }
            _pull(IERC20(item.token), msg.sender, item.amount);
            _contents[giftId].push(item);
        }
        _safeMint(recipient, giftId);
        emit GiftWrapped(giftId, msg.sender, recipient);
    }

    /// @dev A gift held by this contract could never be opened or moved again; plain `transferFrom` would allow it.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (to == address(this)) revert InvalidRecipient(to);
        return super._update(to, tokenId, auth);
    }

    /// @notice Opens a gift: burns it and sends its contents to the holder.
    function open(uint256 giftId) external nonReentrant {
        if (ownerOf(giftId) != msg.sender) revert NotHolder(giftId);
        _burn(giftId);
        Item[] storage items = _contents[giftId];
        for (uint256 i = 0; i < items.length; i++) {
            // One paused token or frozen holder must not hold back the rest: record it and deliver it later.
            if (!IERC20(items[i].token).trySafeTransfer(msg.sender, items[i].amount)) {
                owed[msg.sender][items[i].token] += items[i].amount;
                emit ItemOwed(msg.sender, items[i].token, items[i].amount);
            }
        }
        delete _contents[giftId];
        emit GiftOpened(giftId, msg.sender);
    }

    /// @notice Collects contents that could not be delivered when a gift was opened.
    function claimOwed(address token, address to) external nonReentrant {
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        uint256 amount = owed[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        owed[msg.sender][token] = 0;
        IERC20(token).safeTransfer(to, amount);
        emit OwedClaimed(msg.sender, token, to, amount);
    }

    /// @notice What a sealed gift holds. Opened gifts revert. The page keeps it a surprise, but contents are public
    /// on-chain (this view and the transfer events), so a gift is sealed, not secret.
    function contentsOf(uint256 giftId) external view returns (Item[] memory) {
        _requireOwned(giftId);
        return _contents[giftId];
    }

    // ---------------------------------------------------------------- pictures

    /// @notice Adds a picture to the list, as an image URI (ipfs:// or data:image/). Returns its id.
    function addDesign(string calldata imageUri) external onlyOwner returns (uint256 designId) {
        _checkImageUri(imageUri);
        _designs.push(imageUri);
        designId = _designs.length;
        emit DesignSet(designId, imageUri);
    }

    /// @notice Replaces a picture, or withdraws it with an empty URI; gifts showing it switch with it.
    function setDesign(uint256 designId, string calldata imageUri) external onlyOwner {
        if (designId == 0 || designId > _designs.length) revert BadDesign(designId);
        if (bytes(imageUri).length != 0) _checkImageUri(imageUri);
        _designs[designId - 1] = imageUri;
        emit DesignSet(designId, imageUri);
        if (giftCount != 0) emit BatchMetadataUpdate(1, giftCount);
    }

    /// @notice The switch: lets holders pick a picture for their gift, or stops them. Pictures already picked stay.
    function setDesignChoiceOpen(bool open_) external onlyOwner {
        designChoiceOpen = open_;
        emit DesignChoiceOpened(open_);
    }

    /// @notice The holder picks a listed picture for their gift, or 0 for the built-in one.
    function chooseDesign(uint256 giftId, uint256 designId) external {
        if (!designChoiceOpen) revert DesignChoiceClosed();
        if (ownerOf(giftId) != msg.sender) revert NotHolder(giftId);
        if (designId != 0 && (designId > _designs.length || bytes(_designs[designId - 1]).length == 0)) {
            revert BadDesign(designId);
        }
        designOf[giftId] = designId;
        emit DesignChosen(giftId, designId);
        emit MetadataUpdate(giftId);
    }

    /// @notice Every listed picture by id (index + 1); empty strings are withdrawn.
    function designs() external view returns (string[] memory) {
        return _designs;
    }

    /// @notice On-chain metadata and picture. The picture never shows the contents: a gift stays a surprise.
    function tokenURI(uint256 giftId) public view override returns (string memory) {
        _requireOwned(giftId);
        string memory id = Strings.toString(giftId);
        uint256 designId = designOf[giftId];
        string memory chosen = designId == 0 || designId > _designs.length ? "" : _designs[designId - 1];
        string memory image = bytes(chosen).length != 0
            ? chosen
            : string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(string.concat(_SVG_HEAD, id, _SVG_TAIL))));
        string memory json = string.concat(
            '{"name":"Basqit Gift #',
            id,
            '","description":"A sealed gift of Stock Tokens. Open it on basqit to see what is inside.","image":"',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }

    function _transferOwnership(address newOwner) internal override {
        // Renouncing (a zero owner) is disabled; `renounceOwnership` stays a normal write that reverts here.
        if (newOwner == address(0)) revert RenounceDisabled();
        super._transferOwnership(newOwner);
    }

    /// @dev Only ipfs:// and data:image/ URIs: content that cannot change behind a URI after holders pick it. The URI goes into JSON as is, so quotes, backslashes and
    /// control characters are refused.
    function _checkImageUri(string calldata imageUri) private pure {
        bytes calldata raw = bytes(imageUri);
        if (!_startsWith(raw, "ipfs://") && !_startsWith(raw, "data:image/")) {
            revert BadImageUri();
        }
        for (uint256 i = 0; i < raw.length; i++) {
            if (raw[i] == '"' || raw[i] == "\\" || uint8(raw[i]) < 0x20) revert BadImageUri();
        }
    }

    function _startsWith(bytes calldata raw, bytes memory prefix) private pure returns (bool) {
        if (raw.length <= prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (raw[i] != prefix[i]) return false;
        }
        return true;
    }

    function _pull(IERC20 token, address from, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert ShortDelivery(address(token), received, amount);
    }
}
