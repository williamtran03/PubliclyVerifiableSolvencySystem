// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetSolvencyRegistryTest is Test {
    MultiAssetSolvencyRegistry registry;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MockToken btc;
    MockToken usdc;

    address reserve = address(0xA11CE);
    bytes proof;
    uint256 rootHash;
    uint256 liabilitiesUsd;

    function setUp() public {
        vm.warp(1_700_000_000);

        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);

        MultiAssetSolvencyRegistry.Asset[] memory assets = new MultiAssetSolvencyRegistry.Asset[](3);
        assets[0] = MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8);
        assets[1] = MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18);
        assets[2] = MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6);

        address[] memory reserves = new address[](1);
        reserves[0] = reserve;

        registry = new MultiAssetSolvencyRegistry(assets, reserves, address(new HonkVerifier()), 1 hours);

        // 3 BTC + 2 ETH + 1000 USDC = 180000 + 6000 + 1000 = 187000 USD
        btc.mint(reserve, 3e8);
        vm.deal(reserve, 2 ether);
        usdc.mint(reserve, 1000e6);

        string memory json = vm.readFile("arms/zk-circuit/fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        liabilitiesUsd = vm.parseJsonUint(json, ".totalLiabilitiesUsd");
        proof = vm.readFileBinary("arms/zk-circuit/fixtures/proof.bin");
    }

    // Read straight off the mocks so the negative tests do not go through the
    // validating path before the call under test.
    function latestRounds() internal view returns (uint80[3] memory roundIds) {
        roundIds[0] = btcFeed.latestRound();
        roundIds[1] = ethFeed.latestRound();
        roundIds[2] = usdcFeed.latestRound();
    }

    function test_ReadsTheConversionTableFromTheOracles() public view {
        (uint256[3] memory prices,) = registry.readPrices();
        assertEq(prices[0], 60_000);
        assertEq(prices[1], 3_000);
        assertEq(prices[2], 1);
    }

    function test_ValuesReservesAcrossAllThreeAssets() public view {
        (uint256[3] memory prices,) = registry.readPrices();
        assertEq(registry.totalAssetsUsd(prices), 187_000);
    }

    function test_SubmitEpoch() public {
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, latestRounds());

        (uint256 storedRoot, uint256 storedLiabilities, uint256 storedAssets, uint64 timestamp) =
            registry.currentEpoch();

        assertEq(storedRoot, rootHash);
        assertEq(storedLiabilities, 155_000);
        assertEq(storedAssets, 187_000);
        assertEq(timestamp, block.timestamp);
        assertEq(registry.epochCount(), 1);
        assertEq(registry.epochPrices(0), 60_000);
        assertEq(registry.epochRoundIds(0), 1);
    }

    function test_RevertsWhenTheOraclePriceDiffersFromTheProvenTable() public {
        btcFeed.set(59_000e8, block.timestamp);
        uint80[3] memory roundIds = latestRounds();
        vm.expectRevert(); // the verifier rejects the wrong price table with its own error
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsIfInsolvent() public {
        btc.burn(reserve);
        vm.deal(reserve, 0);
        usdc.burn(reserve);

        uint80[3] memory roundIds = latestRounds();
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 155_000));
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsOnStalePrice() public {
        ethFeed.set(3_000e8, block.timestamp - 2 hours);
        uint80[3] memory roundIds = latestRounds();
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsOnNonPositivePrice() public {
        ethFeed.set(0, block.timestamp);
        uint80[3] memory roundIds = latestRounds();
        vm.expectRevert(MultiAssetSolvencyRegistry.BadPrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsWhenPinningARoundThatHasGoneStale() public {
        uint80[3] memory stale = latestRounds();
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, stale);
    }

    function test_RevertsForNonOwner() public {
        uint80[3] memory roundIds = latestRounds();
        vm.prank(address(0xBEEF));
        vm.expectRevert(MultiAssetSolvencyRegistry.NotOwner.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }
}
