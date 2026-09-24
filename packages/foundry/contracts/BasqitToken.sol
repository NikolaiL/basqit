// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice ERC-20 basket share backed in kind by Stock Tokens.
/// One share (1e18) is redeemable for a fixed amount of each component while the basket is fully
/// backed; if an issuer ever removes tokens from the basket, every holder shares the shortfall pro rata.
/// No owner, no fees, no oracle, no rebalancing: pricing happens off chain.
contract BasqitToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Component {
        address token;
        // raw token amount backing one share
        uint256 unitsPerShare;
    }

    uint256 public constant SHARE_UNIT = 1e18;
    uint256 public constant MAX_COMPONENTS = 10;

    address public immutable factory;

    Component[] private _components;

    /// @notice Components a holder redeemed but could not receive yet (e.g. the token was paused).
    mapping(address holder => mapping(address token => uint256)) public owed;
    /// @notice Sum of `owed` per token: held here but no longer backing shares.
    mapping(address token => uint256) public totalOwed;

    event Minted(address indexed sender, address indexed to, uint256 shares);
    event Redeemed(address indexed sender, address indexed to, uint256 shares);
    event ComponentOwed(address indexed holder, address indexed token, uint256 amount);
    event OwedClaimed(address indexed holder, address indexed token, address indexed to, uint256 amount);

    error EmptyComponents();
    error TooManyComponents(uint256 count);
    error ZeroAddress();
    error ZeroUnits(address token);
    error DuplicateToken(address token);
    error ZeroShares();
    error InvalidRecipient(address to);
    error ShortDelivery(address token, uint256 received, uint256 expected);
    error NothingOwed(address token);

    constructor(string memory name_, string memory symbol_, Component[] memory components_) ERC20(name_, symbol_) {
        uint256 count = components_.length;
        if (count == 0) revert EmptyComponents();
        if (count > MAX_COMPONENTS) revert TooManyComponents(count);
        for (uint256 i = 0; i < count; i++) {
            Component memory c = components_[i];
            if (c.token == address(0)) revert ZeroAddress();
            if (c.unitsPerShare == 0) revert ZeroUnits(c.token);
            for (uint256 j = 0; j < i; j++) {
                if (components_[j].token == c.token) revert DuplicateToken(c.token);
            }
            _components.push(c);
        }
        factory = msg.sender;
    }

    /// @notice Deposit every component and mint shares; amounts round up so minters never underpay.
    function mint(uint256 shares, address to) external nonReentrant {
        if (shares == 0) revert ZeroShares();
        _checkRecipient(to);
        uint256 count = _components.length;
        for (uint256 i = 0; i < count; i++) {
            Component memory c = _components[i];
            uint256 amount = Math.mulDiv(c.unitsPerShare, shares, SHARE_UNIT, Math.Rounding.Ceil);
            // Stock Tokens are issuer-upgradeable; never assume a transfer delivers what it says.
            uint256 before = IERC20(c.token).balanceOf(address(this));
            IERC20(c.token).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(c.token).balanceOf(address(this)) - before;
            if (received != amount) revert ShortDelivery(c.token, received, amount);
        }
        _mint(to, shares);
        emit Minted(msg.sender, to, shares);
    }

    /// @notice Burn shares and withdraw every component. All or nothing: reverts if any component
    /// cannot be transferred. Use `redeemAvailable` when a component is paused or frozen.
    function redeem(uint256 shares, address to) external nonReentrant {
        uint256[] memory amounts = _burnForRedeem(shares, to);
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] != 0) IERC20(_components[i].token).safeTransfer(to, amounts[i]);
        }
        emit Redeemed(msg.sender, to, shares);
    }

    /// @notice Emergency exit: burn shares, receive every component that can move now, and record
    /// the rest as owed to the caller, claimable with `claimOwed` once the token can move again.
    function redeemAvailable(uint256 shares, address to) external nonReentrant {
        uint256[] memory amounts = _burnForRedeem(shares, to);
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) continue;
            address token = _components[i].token;
            if (!IERC20(token).trySafeTransfer(to, amounts[i])) {
                owed[msg.sender][token] += amounts[i];
                totalOwed[token] += amounts[i];
                emit ComponentOwed(msg.sender, token, amounts[i]);
            }
        }
        emit Redeemed(msg.sender, to, shares);
    }

    function claimOwed(address token, address to) external nonReentrant returns (uint256 amount) {
        _checkRecipient(to);
        amount = owed[msg.sender][token];
        if (amount == 0) revert NothingOwed(token);
        owed[msg.sender][token] = 0;
        totalOwed[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit OwedClaimed(msg.sender, token, to, amount);
    }

    function quoteMint(uint256 shares) external view returns (uint256[] memory amounts) {
        uint256 count = _components.length;
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = Math.mulDiv(_components[i].unitsPerShare, shares, SHARE_UNIT, Math.Rounding.Ceil);
        }
    }

    /// @notice Exact amounts `redeem` would pay right now for `shares`.
    function quoteRedeem(uint256 shares) public view returns (uint256[] memory amounts) {
        uint256 count = _components.length;
        uint256 supply = totalSupply();
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = _redeemAmount(_components[i], shares, supply);
        }
    }

    /// @notice False once any component holds less than its full backing (e.g. after an issuer burn).
    function isFullyBacked() external view returns (bool) {
        uint256 supply = totalSupply();
        for (uint256 i = 0; i < _components.length; i++) {
            Component memory c = _components[i];
            if (_available(c.token) < Math.mulDiv(c.unitsPerShare, supply, SHARE_UNIT, Math.Rounding.Ceil)) {
                return false;
            }
        }
        return true;
    }

    function componentCount() external view returns (uint256) {
        return _components.length;
    }

    function componentAt(uint256 index) external view returns (Component memory) {
        return _components[index];
    }

    function components() external view returns (Component[] memory) {
        return _components;
    }

    function _burnForRedeem(uint256 shares, address to) private returns (uint256[] memory amounts) {
        if (shares == 0) revert ZeroShares();
        _checkRecipient(to);
        amounts = quoteRedeem(shares);
        _burn(msg.sender, shares);
    }

    /// @dev Fixed amount per share, rounded down, but never more than a pro-rata slice of what the
    /// basket actually holds. Fully backed baskets pay the fixed amount; a shortfall is shared.
    function _redeemAmount(Component memory c, uint256 shares, uint256 supply) private view returns (uint256) {
        uint256 fixedAmount = Math.mulDiv(c.unitsPerShare, shares, SHARE_UNIT);
        if (supply == 0) return fixedAmount;
        return Math.min(fixedAmount, Math.mulDiv(_available(c.token), shares, supply));
    }

    /// @dev Balance that still backs shares; owed amounts belong to past redeemers.
    function _available(address token) private view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = totalOwed[token];
        return balance > reserved ? balance - reserved : 0;
    }

    function _checkRecipient(address to) private view {
        if (to == address(0)) revert ZeroAddress();
        if (to == address(this)) revert InvalidRecipient(to);
    }
}
