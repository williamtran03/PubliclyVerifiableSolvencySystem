// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

// Reserve mechanics are tested in shared/test/ReserveRegistry.t.sol; this covers the arm.
contract MultiAssetSolvencyRegistryTest is Test {
    // The committed proof binds chain id, registry address and epoch 0, so the registry
    // is placed where arms/zk-circuit/script/Demo.s.sol deploys it on a fresh anvil.
    address constant FIXTURE_REGISTRY = 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6;

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
    uint256 context;
    uint64[3] floors;

    uint64 constant MAX_EPOCH_AGE = 1 days;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");

        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);

        assets.push(MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8, 1 hours));
        assets.push(MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18, 1 hours));
        assets.push(MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6, 1 days));

        verifier = new HonkVerifier();
        deployCodeTo(
            "MultiAssetSolvencyRegistry.sol:MultiAssetSolvencyRegistry",
            abi.encode(company, auditor, assets, address(verifier), MAX_EPOCH_AGE),
            FIXTURE_REGISTRY
        );
        registry = MultiAssetSolvencyRegistry(FIXTURE_REGISTRY);

        // Liabilities are 2 BTC, 10 ETH, 5000 USDC; every asset is covered on its own.
        btc.mint(reserve, 3e8);
        vm.deal(reserve, 12 ether);
        usdc.mint(reserve, 6000e6);
        approveReserve(registry, reserve, reserveKey);

        string memory json = vm.readFile("arms/zk-circuit/fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        context = vm.parseJsonUint(json, ".context");
        uint256[] memory parsed = vm.parseJsonUintArray(json, ".floors");
        for (uint256 i = 0; i < 3; i++) {
            floors[i] = uint64(parsed[i]);
        }
        proof = vm.readFileBinary("arms/zk-circuit/fixtures/proof.bin");
    }

    function approveReserve(MultiAssetSolvencyRegistry target, address wallet, uint256 key) internal {
        vm.prank(company);
        target.proposeReserve(wallet);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.reserveDigest(wallet, block.timestamp));
        target.proveReserve(wallet, block.timestamp, abi.encodePacked(r, s, v));
        vm.prank(auditor);
        target.reviewReserve(wallet, true);
    }

    // Read straight off the mocks so the negative tests do not go through the
    // validating path before the call under test.
    function latestRounds() internal view returns (uint80[3] memory roundIds) {
        roundIds[0] = btcFeed.latestRound();
        roundIds[1] = ethFeed.latestRound();
        roundIds[2] = usdcFeed.latestRound();
    }

    function submit(uint80[3] memory roundIds) internal {
        vm.prank(company);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    // ---- liveness -----------------------------------------------------------

    function test_RegistryIsNotCurrentBeforeAnyEpoch() public view {
        assertFalse(registry.isCurrent());
        assertEq(registry.epochAge(), type(uint64).max);
    }

    function test_PublishingMakesTheRegistryCurrentUntilTheBoundPasses() public {
        submit(latestRounds());
        assertTrue(registry.isCurrent());
        assertEq(registry.epochAge(), 0);

        vm.warp(block.timestamp + MAX_EPOCH_AGE + 1);
        assertFalse(registry.isCurrent(), "an unrefreshed epoch goes stale on its own");
        assertEq(registry.epochAge(), MAX_EPOCH_AGE + 1);
    }

    // ---- epochs -------------------------------------------------------------

    function test_FixtureWasProvedForThisRegistry() public view {
        assertEq(registry.epochContext(0), context);
    }

    function test_SubmitEpoch() public {
        submit(latestRounds());

        MultiAssetSolvencyRegistry.Epoch memory epoch = registry.latestEpoch();
        assertEq(epoch.rootHash, rootHash);
        assertEq(epoch.context, context);
        assertEq(epoch.floors[1], 12);
        assertEq(epoch.reserveUnits[0], 3);
        assertEq(epoch.reserveUnits[1], 12);
        assertEq(epoch.reserveUnits[2], 6000);
        assertEq(epoch.prices[0], 60_000e8);
        assertEq(epoch.roundIds[0], 1);
        // 3 * 60000 + 12 * 3000 + 6000 * 1, with 8 decimals
        assertEq(epoch.assetsUsd, 222_000e8);
        assertEq(epoch.timestamp, block.timestamp);
        assertEq(registry.epochCount(), 1);
        assertEq(registry.getEpoch(0).rootHash, rootHash);
    }

    function test_NoEpochBeforeTheFirstSubmission() public {
        vm.expectRevert(MultiAssetSolvencyRegistry.NoEpoch.selector);
        registry.latestEpoch();
        vm.expectRevert(MultiAssetSolvencyRegistry.NoEpoch.selector);
        registry.getEpoch(0);
    }

    function test_OnlyTheCompanySubmitsEpochs() public {
        uint80[3] memory roundIds = latestRounds();
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_ProofCannotBeReplayedForTheNextEpoch() public {
        submit(latestRounds());

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(); // epoch 1 has a different context, so the verifier rejects the proof
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_ProofIsBoundToTheRegistryItWasBuiltFor() public {
        MultiAssetSolvencyRegistry other =
            new MultiAssetSolvencyRegistry(company, auditor, assets, address(verifier), MAX_EPOCH_AGE);
        approveReserve(other, reserve, reserveKey);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert();
        other.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_RejectsFloorsTheProofWasNotBuiltFor() public {
        uint64[3] memory lower = floors;
        lower[2] = 5999;
        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert();
        registry.submitEpoch(proof, rootHash, lower, roundIds);
    }

    // ---- per-asset solvency -------------------------------------------------

    function test_RejectsAShortfallInOneAssetEvenWhenUsdCoversIt() public {
        // 3 BTC + 2 ETH + 6000 USDC is $192,000 against $155,000 of liabilities, which the
        // old USD-aggregate check accepted. Customers are owed 10 ETH and there are 2.
        vm.deal(reserve, 2 ether);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 1, 2, 12));
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_RevertsIfTheOnlyReserveIsRemoved() public {
        vm.prank(auditor);
        registry.removeReserve(reserve);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 0, 3));
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_UnapprovedReservesAreNotCounted() public {
        (address wallet, uint256 key) = makeAddrAndKey("other");
        btc.mint(wallet, 10e8);
        vm.prank(company);
        registry.proposeReserve(wallet);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(wallet, block.timestamp));
        registry.proveReserve(wallet, block.timestamp, abi.encodePacked(r, s, v));

        assertEq(registry.reserveUnits()[0], 3);
    }

    function test_ADepositToAReserveDoesNotInvalidateTheProof() public {
        // The public input is the floor, not the live balance, so dust cannot grief a submission.
        vm.deal(reserve, 12 ether + 1);
        btc.mint(reserve, 1);
        submit(latestRounds());
        assertEq(registry.epochCount(), 1);
    }

    // ---- oracle -------------------------------------------------------------

    function test_KeepsSubDollarPrices() public {
        usdcFeed.set(99_986_506, block.timestamp); // live Sepolia USDC/USD, $0.99986506
        (uint256[3] memory prices,) = registry.readPrices();
        assertEq(prices[2], 99_986_506);

        submit(latestRounds());
        assertEq(registry.latestEpoch().assetsUsd, 216_000e8 + 6000 * 99_986_506);
    }

    function test_NormalisesFeedDecimals() public {
        MultiAssetSolvencyRegistry.Asset[] memory wide = assets;
        wide[1].feed = address(new MockAggregator(18, 3_000e18));
        MultiAssetSolvencyRegistry other =
            new MultiAssetSolvencyRegistry(company, auditor, wide, address(verifier), MAX_EPOCH_AGE);

        (uint256[3] memory prices,) = other.readPrices();
        assertEq(prices[1], 3_000e8);
    }

    function test_StalenessIsJudgedPerFeed() public {
        vm.warp(block.timestamp + 2 hours);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        registry.readPrices(); // USDC is 2 hours old, inside its 1 day bound

        vm.warp(block.timestamp + 23 hours);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.readPrices();
    }

    function test_PinnedRoundsSurviveAFeedUpdate() public {
        uint80[3] memory pinned = latestRounds();
        btcFeed.set(59_000e8, block.timestamp); // lands between fetching and submitting

        submit(pinned);
        MultiAssetSolvencyRegistry.Epoch memory epoch = registry.latestEpoch();
        assertEq(epoch.roundIds[0], 1);
        assertEq(epoch.prices[0], 60_000e8);
    }

    function test_RevertsOnNonPositivePrice() public {
        ethFeed.set(0, block.timestamp);
        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.BadPrice.selector);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_RevertsWhenPinningARoundThatHasGoneStale() public {
        uint80[3] memory stale = latestRounds();
        vm.warp(block.timestamp + 2 hours);
        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, floors, stale);
    }
}
