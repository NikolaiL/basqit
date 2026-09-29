// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployHelpers.s.sol";
import { BasqitPacks } from "../contracts/packs/BasqitPacks.sol";
import { BasqitGifts } from "../contracts/packs/BasqitGifts.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";
import { MockDiceEntropy } from "../contracts/mocks/MockDiceEntropy.sol";
import { BasqitGiftRouter } from "../contracts/packs/BasqitGiftRouter.sol";
import { TestnetSwapAdapter } from "../contracts/packs/TestnetSwapAdapter.sol";
import { BasqitFactory } from "../contracts/BasqitFactory.sol";

/**
 * @notice Packs demo on Robinhood Chain testnet (46630) or the local chain (31337). Never mainnet.
 *  - Test tokens: tUSDG (6 decimals) and five test "stock" tokens with no value, minted by the deployer.
 *  - Faucet: 100 tUSDG per address per day, global daily cap.
 *  - Gifts: seal listed tokens into a gift NFT. Buying goes through BasqitGiftRouter and a testnet swap adapter
 *    that sells test stocks at owner-set prices (script/sync-gift-prices.sh keeps them at live prices).
 *  - Packs: a 10-pack template with a 50-round prize reserve; anyone starts the next round once the
 *    last is done. Drawn by Dice Protocol (https://diceprotocol.world) on testnet, MockDiceEntropy locally.
 *
 * forge script script/DeployPacks.s.sol --rpc-url robinhoodTestnet --private-key $TESTNET_DEPLOYER_PRIVATE_KEY --broadcast
 */
contract DeployPacks is ScaffoldETHDeploy {
    /// Dice docs, testnet section: https://diceprotocol.world/docs/ (verified on-chain 28 Sept 2026).
    address internal constant DICE_TESTNET = 0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D;

    error UnsupportedNetwork(uint256 chainId);

    function run() external ScaffoldEthDeployerRunner {
        address dice;
        if (block.chainid == 46630) dice = DICE_TESTNET;
        else if (block.chainid == 31337) dice = address(new MockDiceEntropy());
        else revert UnsupportedNetwork(block.chainid);

        TestnetToken usdg = new TestnetToken("Test Global Dollar (testnet, no value)", "tUSDG", 6, deployer);
        string[5] memory symbols = ["NVDA", "AAPL", "TSLA", "AMZN", "META"];
        TestnetToken[5] memory stocks;
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new TestnetToken(
                string.concat("Test ", symbols[i], " (testnet, no value)"), string.concat("t", symbols[i]), 18, deployer
            );
            stocks[i].mint(deployer, 1_000_000e18);
        }

        BasqitTestnetFaucet faucet = new BasqitTestnetFaucet(address(usdg), 100e6, 1 days, 100_000e6);
        usdg.setMinter(address(faucet), true);

        BasqitPacks packs = new BasqitPacks(deployer, dice);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].approve(address(packs), type(uint256).max);
        }

        // Gifts: the factory lists the test stocks; the router buys them from the testnet adapter (standing in
        // for Uniswap) at mainnet Stock Token prices of 29 Sept 2026, then seals them for the recipient.
        address[] memory listed = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            listed[i] = address(stocks[i]);
        }
        // One token list for baskets and gifts: the factory's.
        BasqitFactory factory = new BasqitFactory(deployer, listed);
        BasqitGifts gifts = new BasqitGifts(deployer, address(factory));
        TestnetSwapAdapter shop = new TestnetSwapAdapter(address(usdg), deployer);
        uint256[5] memory usdPrices = [uint256(229.92e6), 337.54e6, 358.32e6, 246.33e6, 716.52e6];
        for (uint256 i = 0; i < 5; i++) {
            shop.setPrice(address(stocks[i]), usdPrices[i]);
            stocks[i].transfer(address(shop), 1000e18);
        }
        address[] memory adapters = new address[](1);
        adapters[0] = address(shop);
        new BasqitGiftRouter(address(usdg), address(factory), address(gifts), deployer, adapters);

        // Packs: 10 packs at 1 tUSDG. Prizes add up to 75% of sales ($7.50 of $10) at mainnet Stock Token
        // prices on 29 Sept 2026 (NVDA 229.92, AAPL 337.54, TSLA 358.32, AMZN 246.33, META 716.52); they drift with
        // prices. One $3 slot, the rest $1 down to $0.20.
        uint256[10] memory amounts = [
            uint256(0.013048e18), // NVDA  $3.00
            0.002963e18, // AAPL $1.00
            0.001954e18, // TSLA $0.70
            0.002436e18, // AMZN $0.60
            0.000698e18, // META $0.50
            0.001957e18, // NVDA $0.45
            0.001185e18, // AAPL $0.40
            0.000977e18, // TSLA $0.35
            0.001218e18, // AMZN $0.30
            0.000279e18 // META $0.20
        ];
        BasqitPacks.Prize[] memory prizes = new BasqitPacks.Prize[](10);
        for (uint256 i = 0; i < 10; i++) {
            prizes[i] = BasqitPacks.Prize(address(stocks[i % 5]), amounts[i]);
        }
        // Anyone can start the next round from this template once the last one is done; the reserve covers
        // 50 rounds. The first round is opened the same way visitors will open later ones.
        // 4 h draw timeout: well past Dice's usual seconds and the sequencer's ~1 h timestamp drift.
        packs.setTemplate(address(usdg), 1e6, prizes, 30 days, 4 hours);
        for (uint256 i = 0; i < 5; i++) {
            uint256 perRound;
            for (uint256 j = 0; j < 10; j++) {
                if (prizes[j].token == address(stocks[i])) perRound += prizes[j].amount;
            }
            packs.fundReserve(address(stocks[i]), perRound * 50);
        }
        packs.startNextRound();
    }
}
