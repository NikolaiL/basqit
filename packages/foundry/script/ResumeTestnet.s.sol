// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployTestnet.s.sol";

/// @notice Recover a testnet deployment interrupted immediately after factory creation.
/// Set DEPLOYMENT_BROADCAST to the original broadcast JSON. Reuses its confirmed deployments.
contract ResumeTestnet is DeployTestnet {
    function run() external override ScaffoldEthDeployerRunner {
        require(block.chainid == 46630, "Testnet only");
        string memory data = vm.readFile(vm.envString("DEPLOYMENT_BROADCAST"));
        require(vm.parseJsonUint(data, ".receipts[16].status") == 1, "Factory deployment not confirmed");
        require(!vm.keyExistsJson(data, ".receipts[17]"), "Unexpected recovery stage");

        usdg = TestnetToken(_deployed(data, 0));
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = TestnetToken(_deployed(data, 1 + 2 * i));
        }
        weth = TestnetToken(_deployed(data, 11));
        shop = TestnetSwapAdapter(_deployed(data, 15));
        factory = BasqitFactory(_deployed(data, 16));
        require(factory.owner() == deployer && shop.owner() == deployer, "Wrong deployer");
        require(factory.basketCount() == 0 && usdg.balanceOf(address(shop)) == 0, "Already initialized");

        _seedShop();
        _baskets();
        BasqitGifts gifts = new BasqitGifts(deployer, address(factory));
        new BasqitGiftRouter(address(usdg), address(factory), address(gifts), deployer, _adapters());
        _packs(DICE_TESTNET);
    }

    function _deployed(string memory data, uint256 index) internal view returns (address addr) {
        addr = vm.parseJsonAddress(data, string.concat(".transactions[", vm.toString(index), "].contractAddress"));
        require(addr.code.length != 0, "Missing deployed contract");
    }
}
