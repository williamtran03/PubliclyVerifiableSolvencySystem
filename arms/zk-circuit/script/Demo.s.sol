// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetDemo is Script {
    // Standard anvil dev accounts 0 and 1; public keys, local chain only.
    uint256 constant COMPANY_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant AUDITOR_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    // A cold wallet with no ETH for gas: it only signs, the company relays.
    uint256 constant RESERVE_KEY = uint256(keccak256("northwind cold wallet"));

    address company;
    address auditor;
    address reserve;

    MockToken btc;
    MockToken usdc;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MultiAssetSolvencyRegistry registry;

    function run() external {
        company = vm.addr(COMPANY_KEY);
        auditor = vm.addr(AUDITOR_KEY);
        reserve = vm.addr(RESERVE_KEY);

        string memory json = vm.readFile("arms/zk-circuit/fixtures/epoch.json");
        uint256 rootHash = vm.parseJsonUint(json, ".rootHash");
        uint256 liabilitiesUsd = vm.parseJsonUint(json, ".totalLiabilitiesUsd");
        bytes memory proof = vm.readFileBinary("arms/zk-circuit/fixtures/proof.bin");

        vm.startBroadcast(COMPANY_KEY);
        deploy();
        fundReserve();
        proposeAndProveReserve();
        vm.stopBroadcast();

        vm.startBroadcast(AUDITOR_KEY);
        registry.reviewReserve(reserve, true);
        console.log("==> auditor approved the reserve; it now counts towards assets");
        vm.stopBroadcast();

        vm.startBroadcast(COMPANY_KEY);
        submit(proof, rootHash, liabilitiesUsd);
        vm.stopBroadcast();

        // Outside the broadcast on purpose: this attempt is meant to revert, and a
        // reverting broadcast transaction aborts the whole run before anything lands.
        showPriceBinding(proof, rootHash, liabilitiesUsd);
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

        registry = new MultiAssetSolvencyRegistry(company, auditor, assets, address(new HonkVerifier()), 1 hours);
        console.log("==> registry deployed at", address(registry));
        console.log("    company:", company);
        console.log("    auditor:", auditor);
    }

    function fundReserve() internal {
        btc.mint(reserve, 3e8);
        usdc.mint(reserve, 1000e6);
        payable(reserve).transfer(2 ether);
        console.log("==> reserve funded: 3 BTC, 2 ETH, 1000 USDC at", reserve);
    }

    function proposeAndProveReserve() internal {
        registry.proposeReserve(reserve);
        console.log("==> company proposed the reserve");

        uint256 expiry = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESERVE_KEY, registry.reserveDigest(reserve, expiry));
        registry.proveReserve(reserve, expiry, abi.encodePacked(r, s, v));
        console.log("==> reserve signed the EIP-712 challenge off-chain; company relayed it");
    }

    function submit(bytes memory proof, uint256 rootHash, uint256 liabilitiesUsd) internal {
        (uint256[3] memory prices, uint80[3] memory roundIds) = registry.readPrices();
        console.log("==> conversion table read on-chain:", prices[0], prices[1], prices[2]);
        console.log("==> pinned oracle rounds:", roundIds[0], roundIds[1], roundIds[2]);
        console.log("==> reserves valued at USD:", registry.totalAssetsUsd(prices));
        console.log("==> proven liabilities USD:", liabilitiesUsd);

        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
        (, uint256 storedLiabilities, uint256 storedAssets,) = registry.currentEpoch();
        console.log("OK: epoch accepted, assets USD:", storedAssets);
        console.log("    against liabilities USD:", storedLiabilities);
    }

    function showPriceBinding(bytes memory proof, uint256 rootHash, uint256 liabilitiesUsd) internal {
        btcFeed.set(59_000e8, block.timestamp);
        (, uint80[3] memory newRounds) = registry.readPrices();
        console.log("==> BTC feed moved to $59000, resubmitting the same proof at the new round");
        vm.prank(company);
        try registry.submitEpoch(proof, rootHash, liabilitiesUsd, newRounds) {
            console.log("FAIL: proof accepted under a different price table");
        } catch {
            console.log("OK: rejected, the proof is bound to the table it was proved against");
        }
    }
}
