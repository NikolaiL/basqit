// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { BasqitPacks2 } from "../contracts/packs/BasqitPacks2.sol";
import { BasqitTestnetFaucet } from "../contracts/packs/BasqitTestnetFaucet.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

interface ISharedAssetFactory {
    function usdG() external view returns (address);
    function allowedTokens() external view returns (address[] memory);
    function isAllowedToken(address token) external view returns (bool);
    function priceReference() external view returns (address);
}

interface ISharedAssetPrices {
    function priceUsdG(address token) external view returns (uint256);
}

/// @notice Replace the team-only Packs prototype using the existing Gifts/Baskets assets and USDG faucet.
contract DeployPacks2SharedAssets is ScaffoldETHDeploy {
    using SafeERC20 for IERC20;

    function run() external returns (BasqitPacks2 packs) {
        require(block.chainid == 46630, "Robinhood testnet only");
        ISharedAssetFactory factory = ISharedAssetFactory(vm.envAddress("PACKS2_SHARED_FACTORY"));
        address payment = factory.usdG();
        address paymentFaucet = vm.envAddress("PACKS2_SHARED_FAUCET");
        require(address(BasqitTestnetFaucet(paymentFaucet).token()) == payment, "Wrong shared faucet");
        require(IERC20Metadata(payment).decimals() == 6, "Wrong payment decimals");
        address beacon = vm.envAddress("PACKS2_DRAND_BEACON");
        require(
            beacon.codehash == 0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924,
            "Unverified drand verifier"
        );
        address implementation = vm.envAddress("PACKS2_IMPLEMENTATION");
        require(implementation.codehash == vm.envBytes32("PACKS2_IMPLEMENTATION_CODEHASH"), "Wrong implementation");
        require(
            BasqitPacks2(implementation).proxiableUUID()
                == 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
            "Not UUPS"
        );
        address[5] memory tokens;
        uint256[5] memory references;
        string[5] memory symbols = ["tNVDA", "tAAPL", "tMETA", "tAMZN", "tTSLA"];
        address[] memory listed = factory.allowedTokens();
        ISharedAssetPrices prices = ISharedAssetPrices(factory.priceReference());
        for (uint256 i; i < 5; i++) {
            for (uint256 j; j < listed.length; j++) {
                if (
                    factory.isAllowedToken(listed[j])
                        && keccak256(bytes(IERC20Metadata(listed[j]).symbol())) == keccak256(bytes(symbols[i]))
                ) {
                    require(tokens[i] == address(0), "Ambiguous stock ticker");
                    tokens[i] = listed[j];
                }
            }
            require(tokens[i] != address(0) && IERC20Metadata(tokens[i]).decimals() == 18, "Missing shared stock");
            references[i] = prices.priceUsdG(tokens[i]);
            require(references[i] > 0, "Missing shared reference price");
        }

        deployer = _startBroadcast();
        BasqitPacks2 previous = BasqitPacks2(vm.envAddress("PACKS2_PREVIOUS_PROXY"));
        require(previous.owner() == deployer, "Previous proxy owner only");
        BasqitPacks2.Tier[] memory table = new BasqitPacks2.Tier[](1);
        table[0] = BasqitPacks2.Tier(tokens[0], 0.0001e18, 1000);
        packs = BasqitPacks2(
            address(
                new ERC1967Proxy(
                    implementation, abi.encodeCall(BasqitPacks2.initialize, (deployer, payment, beacon, 100_000, table))
                )
            )
        );
        packs.initializeStarter(references[0]);
        packs.initializePackTypes(references[0]);
        packs.initializeMixedPackTypes(tokens, references);
        packs.initializeStockSelection();
        packs.initializeEightyPercentPayouts();
        for (uint256 i; i < 5; i++) {
            IERC20(tokens[i]).safeTransfer(address(packs), 100e18);
        }
        previous.setOpensPaused(true);
        _stopBroadcast();

        if (vm.isContext(VmSafe.ForgeContext.ScriptGroup)) {
            deployments.push(Deployment("BasqitPacks2", address(packs)));
            deployments.push(Deployment("Packs2Implementation", implementation));
            deployments.push(Deployment("Packs2PaymentToken", payment));
            deployments.push(Deployment("Packs2PaymentFaucet", paymentFaucet));
            deployments.push(Deployment("Packs2DrandBeacon", beacon));
            deployments.push(Deployment("Packs2AssetFactory", address(factory)));
            string[5] memory labels =
                ["Packs2StockToken", "Packs2StockAAPL", "Packs2StockMETA", "Packs2StockAMZN", "Packs2StockTSLA"];
            for (uint256 i; i < 5; i++) {
                deployments.push(Deployment(labels[i], tokens[i]));
            }
            string memory json;
            for (uint256 i; i < deployments.length; i++) {
                json = vm.serializeString("packs2_shared", vm.toString(deployments[i].addr), deployments[i].name);
            }
            vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/packs2/46630.json"));
        }
    }
}
