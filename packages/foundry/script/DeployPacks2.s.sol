// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./DeployHelpers.s.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";
import { TestnetToken } from "../contracts/packs/TestnetToken.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Independent Packs2 test deployment. Local use requires a Robinhood mainnet fork.
/// On testnet supply PACKS2_DRAND_BEACON for a separately verified evmnet verifier on that chain.
contract DeployPacks2 is ScaffoldETHDeploy {
    function run() external {
        require(block.chainid == 31337 || block.chainid == 46630, "Testnet only");
        address beacon = block.chainid == 31337
            ? address(0xb7133cCaba74EB06292b9232A1723Bc31eDAAC51)
            : vm.envAddress("PACKS2_DRAND_BEACON");
        require(
            beacon.codehash == 0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924,
            "Unverified drand verifier"
        );
        uint256 referencePrice = vm.envUint("PACKS2_REFERENCE_PRICE_USDG");
        deployer = _startBroadcast();
        TestnetToken payment = new TestnetToken("Packs2 Test Dollar (no value)", "tUSDG", 6, deployer);
        TestnetToken stock = new TestnetToken("Packs2 Test NVIDIA (no value)", "tNVDA", 18, deployer);
        BasqitTestnetFaucet paymentFaucet = block.chainid == 31337
            ? new BasqitTestnetFaucet(address(payment), 10_000e6, 1 minutes, 1_000_000e6)
            : new BasqitTestnetFaucet(address(payment), 100e6, 1 days, 100_000e6);
        BasqitTestnetFaucet stockFaucet = new BasqitTestnetFaucet(address(stock), 1e18, 1 days, 1000e18);
        payment.setMinter(address(paymentFaucet), true);
        stock.setMinter(address(stockFaucet), true);

        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](4);
        table[0] = BasqitPacks2.Tier(address(stock), 0.0001e18, 500);
        table[1] = BasqitPacks2.Tier(address(stock), 0.0003e18, 800);
        table[2] = BasqitPacks2.Tier(address(stock), 0.001e18, 990);
        table[3] = BasqitPacks2.Tier(address(stock), 0.01e18, 1000);
        BasqitPacks2 implementation = new BasqitPacks2();
        BasqitPacks2 packs = BasqitPacks2(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(BasqitPacks2.initialize, (deployer, address(payment), beacon, 100_000, table))
                )
            )
        );
        packs.initializeStarter(referencePrice);
        packs.initializePackTypes(referencePrice);
        stock.mint(address(packs), block.chainid == 46630 ? 100e18 : 1e18);
        if (block.chainid == 46630) {
            address[5] memory tokens;
            tokens[0] = address(stock);
            uint256[5] memory references = [
                referencePrice,
                vm.envUint("PACKS2_AAPL_REFERENCE"),
                vm.envUint("PACKS2_MSFT_REFERENCE"),
                vm.envUint("PACKS2_AMZN_REFERENCE"),
                vm.envUint("PACKS2_TSLA_REFERENCE")
            ];
            string[4] memory names = ["Apple", "Microsoft", "Amazon", "Tesla"];
            string[4] memory symbols = ["tAAPL", "tMSFT", "tAMZN", "tTSLA"];
            for (uint256 i; i < 4; i++) {
                TestnetToken token =
                    new TestnetToken(string.concat("Packs2 Test ", names[i], " (no value)"), symbols[i], 18, deployer);
                BasqitTestnetFaucet faucet = new BasqitTestnetFaucet(address(token), 1e18, 1 days, 1000e18);
                token.setMinter(address(faucet), true);
                tokens[i + 1] = address(token);
                token.mint(address(packs), 100e18);
            }
            packs.initializeMixedPackTypes(tokens, references);
            packs.initializeStockSelection();
            packs.initializeEightyPercentPayouts();
        }

        deployments.push(Deployment("BasqitPacks2", address(packs)));
        deployments.push(Deployment("Packs2Implementation", address(implementation)));
        deployments.push(Deployment("Packs2PaymentToken", address(payment)));
        deployments.push(Deployment("Packs2StockToken", address(stock)));
        deployments.push(Deployment("Packs2PaymentFaucet", address(paymentFaucet)));
        deployments.push(Deployment("Packs2StockFaucet", address(stockFaucet)));
        _stopBroadcast();
        string memory json;
        for (uint256 i; i < deployments.length; i++) {
            json = vm.serializeString("packs2", vm.toString(deployments[i].addr), deployments[i].name);
        }
        string memory directory = string.concat(vm.projectRoot(), "/deployments/packs2/");
        vm.createDir(directory, true);
        vm.writeJson(json, string.concat(directory, vm.toString(block.chainid), ".json"));
    }
}
