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

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Testnet only: hands out test USDG so people can try Packs. Per-address cooldown plus a global daily cap,
/// since a cooldown alone does nothing against many addresses. Deploys only on Robinhood Chain testnet and the local chain.
contract BasqitTestnetFaucet {
    IMintable public immutable token;
    uint256 public immutable amount;
    uint256 public immutable cooldown;
    uint256 public immutable dailyCap;
    mapping(address account => uint256) public lastDrip;
    mapping(uint256 day => uint256) public mintedOnDay;

    event Dripped(address indexed to, uint256 amount);

    error NotTestnet();
    error BadConfig();
    error TooSoon(uint256 nextAt);
    error DailyCapReached();

    constructor(address token_, uint256 amount_, uint256 cooldown_, uint256 dailyCap_) {
        if (block.chainid != 46630 && block.chainid != 31337) revert NotTestnet();
        if (token_.code.length == 0 || amount_ == 0 || cooldown_ == 0 || dailyCap_ < amount_) revert BadConfig();
        token = IMintable(token_);
        amount = amount_;
        cooldown = cooldown_;
        dailyCap = dailyCap_;
    }

    function drip() external {
        uint256 last = lastDrip[msg.sender];
        if (last != 0 && block.timestamp < last + cooldown) revert TooSoon(last + cooldown);
        uint256 day = block.timestamp / 1 days;
        if (mintedOnDay[day] + amount > dailyCap) revert DailyCapReached();
        lastDrip[msg.sender] = block.timestamp;
        mintedOnDay[day] += amount;
        token.mint(msg.sender, amount);
        emit Dripped(msg.sender, amount);
    }
}
