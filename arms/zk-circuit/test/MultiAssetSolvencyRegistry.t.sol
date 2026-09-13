// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetSolvencyRegistryTest is Test {
    MultiAssetSolvencyRegistry registry;
    HonkVerifier verifier;
    MultiAssetSolvencyRegistry.Asset[] assets;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MockToken btc;
    MockToken usdc;

    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;
    uint256 reserveKey;
    bytes proof;
    uint256 rootHash;
    uint256 liabilitiesUsd;

    function setUp() public {
        vm.warp(1_700_000_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");

        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);

        assets.push(MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8));
        assets.push(MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18));
        assets.push(MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6));

        verifier = new HonkVerifier();
        registry = new MultiAssetSolvencyRegistry(company, auditor, assets, address(verifier), 1 hours);

        // 3 BTC + 2 ETH + 1000 USDC = 180000 + 6000 + 1000 = 187000 USD
        btc.mint(reserve, 3e8);
        vm.deal(reserve, 2 ether);
        usdc.mint(reserve, 1000e6);
        approveReserve(reserve, reserveKey);

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

    function sign(address wallet, uint256 key, uint256 expiry) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(wallet, expiry));
        return abi.encodePacked(r, s, v);
    }

    function approveReserve(address wallet, uint256 key) internal {
        vm.prank(company);
        registry.proposeReserve(wallet);
        registry.proveReserve(wallet, block.timestamp + 1 hours, sign(wallet, key, block.timestamp + 1 hours));
        vm.prank(auditor);
        registry.reviewReserve(wallet, true);
    }

    function submit(uint80[3] memory roundIds) internal {
        vm.prank(company);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    // ---- roles (reserve mechanics are tested in shared/test/ReserveRegistry.t.sol) ----

    function test_OnlyTheCompanySubmitsEpochs() public {
        uint80[3] memory roundIds = latestRounds();
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    // ---- valuation ----------------------------------------------------------

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

    function test_UnapprovedReservesAreNotCounted() public {
        (address wallet, uint256 key) = makeAddrAndKey("other");
        btc.mint(wallet, 10e8);
        vm.prank(company);
        registry.proposeReserve(wallet);
        registry.proveReserve(wallet, block.timestamp, sign(wallet, key, block.timestamp));

        (uint256[3] memory prices,) = registry.readPrices();
        assertEq(registry.totalAssetsUsd(prices), 187_000);
    }

    // ---- epochs -------------------------------------------------------------

    function test_SubmitEpoch() public {
        submit(latestRounds());

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
        vm.prank(company);
        vm.expectRevert(); // the verifier rejects the wrong price table with its own error
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsIfInsolvent() public {
        btc.burn(reserve);
        vm.deal(reserve, 0);
        usdc.burn(reserve);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 155_000));
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsIfTheOnlyReserveIsRemoved() public {
        vm.prank(auditor);
        registry.removeReserve(reserve);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 155_000));
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsOnStalePrice() public {
        ethFeed.set(3_000e8, block.timestamp - 2 hours);
        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsOnNonPositivePrice() public {
        ethFeed.set(0, block.timestamp);
        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.BadPrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, roundIds);
    }

    function test_RevertsWhenPinningARoundThatHasGoneStale() public {
        uint80[3] memory stale = latestRounds();
        vm.warp(block.timestamp + 2 hours);
        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd, stale);
    }
}
