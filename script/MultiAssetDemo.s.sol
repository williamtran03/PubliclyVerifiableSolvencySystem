// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetDemo is Script {
    address constant RESERVE = address(0xA11CE);

    MockToken btc;
    MockToken usdc;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MultiAssetSolvencyRegistry registry;

    function run() external {
        string memory json = vm.readFile("fixtures/multiasset-epoch.json");
        uint256 rootHash = vm.parseJsonUint(json, ".rootHash");
        uint256 liabilitiesUsd = vm.parseJsonUint(json, ".totalLiabilitiesUsd");
        bytes memory proof = vm.readFileBinary("fixtures/multiasset-proof.bin");

        vm.startBroadcast();
        deploy();
        fundReserves();
        submit(proof, rootHash, liabilitiesUsd);
        showPriceBinding(proof, rootHash, liabilitiesUsd);
        vm.stopBroadcast();
    }

    function deploy() internal {
        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);
        console.log("==> feeds deployed: BTC $60000, ETH $3000, USDC $1");

        MultiAssetSolvencyRegistry.Asset[] memory assets = new MultiAssetSolvencyRegistry.Asset[](3);
        assets[0] = MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8);
        assets[1] = MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18);
        assets[2] = MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6);

        address[] memory reserves = new address[](1);
        reserves[0] = RESERVE;

        registry = new MultiAssetSolvencyRegistry(assets, reserves, address(new HonkVerifier()), 1 hours);
        console.log("==> registry deployed at", address(registry));
    }

    function fundReserves() internal {
        btc.mint(RESERVE, 3e8);
        usdc.mint(RESERVE, 1000e6);
        payable(RESERVE).transfer(2 ether);
        console.log("==> reserve funded: 3 BTC, 2 ETH, 1000 USDC");
    }

    function submit(bytes memory proof, uint256 rootHash, uint256 liabilitiesUsd) internal {
        uint256[3] memory prices = registry.readPrices();
        console.log("==> conversion table read on-chain:", prices[0], prices[1], prices[2]);
        console.log("==> reserves valued at USD:", registry.totalAssetsUsd(prices));
        console.log("==> proven liabilities USD:", liabilitiesUsd);

        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
        (, uint256 storedLiabilities, uint256 storedAssets,) = registry.currentEpoch();
        console.log("OK: epoch accepted, assets USD:", storedAssets);
        console.log("    against liabilities USD:", storedLiabilities);
    }

    function showPriceBinding(bytes memory proof, uint256 rootHash, uint256 liabilitiesUsd) internal {
        btcFeed.set(59_000e8, block.timestamp);
        console.log("==> BTC feed moved to $59000, resubmitting the same proof");
        try registry.submitEpoch(proof, rootHash, liabilitiesUsd) {
            console.log("FAIL: proof accepted under a different price table");
        } catch {
            console.log("OK: rejected, the proof is bound to the table it was proved against");
        }
    }
}
