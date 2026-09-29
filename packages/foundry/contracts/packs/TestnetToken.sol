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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet stand-in for USDG or a Stock Token. Only the owner and approved minters (the faucet) can mint,
/// so nobody can mint unlimited balances and buy out a demo. Deploys only on Robinhood Chain testnet and the local chain.
contract TestnetToken is ERC20, Ownable {
    uint8 private immutable _decimals;
    mapping(address account => bool) public minters;

    event MinterSet(address indexed account, bool allowed);

    error NotTestnet();
    error NotMinter();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address initialOwner)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
    {
        if (block.chainid != 46630 && block.chainid != 31337) revert NotTestnet();
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        minters[account] = allowed;
        emit MinterSet(account, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !minters[msg.sender]) revert NotMinter();
        _mint(to, amount);
    }
}
