// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";
import {HonkVerifier, Errors} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetSolvencyRegistryTest is Test {
    address constant FIXTURE_REGISTRY = 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6;

    MultiAssetSolvencyRegistry registry;
    ReserveDirectory directory;
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
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");
        directory = new ReserveDirectory();

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
            abi.encode(company, auditor, assets, address(verifier), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory),
            FIXTURE_REGISTRY
        );
        registry = MultiAssetSolvencyRegistry(FIXTURE_REGISTRY);

        btc.mint(reserve, 3e8);
        vm.deal(reserve, 12 ether);
        usdc.mint(reserve, 6000e6);
        approveReserve(registry, reserve, reserveKey);
        sample(registry);

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
        proveControl(target, wallet, key);
        vm.prank(auditor);
        target.reviewReserve(wallet, true);
    }

    function proveControl(MultiAssetSolvencyRegistry target, address wallet, uint256 key) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.reserveDigest(wallet));
        target.proveReserve(wallet, abi.encodePacked(r, s, v));
    }

    function sample(MultiAssetSolvencyRegistry target) internal {
        vm.prank(auditor);
        target.sampleReserves();
        vm.roll(block.number + 1);
    }

    function latestRounds() internal view returns (uint80[3] memory roundIds) {
        roundIds[0] = btcFeed.latestRound();
        roundIds[1] = ethFeed.latestRound();
        roundIds[2] = usdcFeed.latestRound();
    }

    function submit(uint80[3] memory roundIds) internal {
        vm.prank(company);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_RejectsTheSameTokenUnderTwoAssetIds() public {
        MultiAssetSolvencyRegistry.Asset[] memory duplicate = new MultiAssetSolvencyRegistry.Asset[](3);
        duplicate[0] = MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8, 1 hours);
        duplicate[1] = MultiAssetSolvencyRegistry.Asset(address(btc), address(ethFeed), 18, 1 hours);
        duplicate[2] = MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6, 1 days);

        vm.expectRevert(MultiAssetSolvencyRegistry.DuplicateAsset.selector);
        new MultiAssetSolvencyRegistry(
            company, auditor, duplicate, address(verifier), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory
        );
    }

    function test_GasForASuccessfulSubmission() public {
        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        uint256 before = gasleft();
        registry.submitEpoch(proof, rootHash, floors, roundIds);
        uint256 used = before - gasleft();
        emit log_named_uint("zk submitEpoch gas", used);
        assertLt(used, 5_200_000, "a regression beyond the figure the comparison quotes");
    }

    function test_GasForPreparedSubmission() public {
        bytes memory payload = abi.encodeCall(registry.submitEpoch, (proof, rootHash, floors, latestRounds()));
        address target = address(registry);
        vm.prank(company);
        uint256 before = gasleft();
        (bool ok,) = target.call(payload);
        uint256 used = before - gasleft();
        assertTrue(ok);
        emit log_named_uint("zk prepared submitEpoch gas", used);
    }

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

    function test_RejectsARoundThatCarriedAnOlderAnswer() public {
        btcFeed.set(60_000e8, block.timestamp);
        uint80[3] memory roundIds = latestRounds();
        btcFeed.setAnsweredInRound(roundIds[0], roundIds[0] - 1);

        vm.prank(company);
        vm.expectRevert(MultiAssetSolvencyRegistry.StaleRound.selector);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_FixtureWasProvedForThisRegistry() public view {
        assertEq(registry.epochContext(0), context);
    }

    function test_SubmitEpoch() public {
        submit(latestRounds());

        MultiAssetSolvencyRegistry.Epoch memory epoch = registry.latestEpoch();
        assertEq(epoch.rootHash, rootHash);
        assertEq(epoch.context, context);
        assertEq(epoch.floors[1], 12e8);
        assertEq(epoch.reserveUnits[0], 3e8);
        assertEq(epoch.reserveUnits[1], 12e8);
        assertEq(epoch.reserveUnits[2], 6000e8);
        assertEq(epoch.prices[0], 60_000e8);
        assertEq(epoch.roundIds[0], 1);
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
        vm.warp(block.timestamp + MIN_EPOCH_INTERVAL);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        proveControl(registry, reserve, reserveKey);
        sample(registry);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(Errors.SumcheckFailed.selector);
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_ProofIsBoundToTheRegistryItWasBuiltFor() public {
        MultiAssetSolvencyRegistry other = new MultiAssetSolvencyRegistry(
            company, auditor, assets, address(verifier), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, new ReserveDirectory()
        );
        approveReserve(other, reserve, reserveKey);
        sample(other);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(Errors.SumcheckFailed.selector);
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

    function test_RejectsAShortfallInOneAssetEvenWhenUsdCoversIt() public {
        vm.deal(reserve, 2 ether);
        sample(registry);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 1, 2e8, 12e8));
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_RevertsIfTheOnlyReserveIsRemoved() public {
        vm.prank(auditor);
        registry.removeReserve(reserve);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 0, 3e8));
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_UnapprovedReservesAreNotCounted() public {
        (address wallet, uint256 key) = makeAddrAndKey("other");
        btc.mint(wallet, 10e8);
        vm.prank(company);
        registry.proposeReserve(wallet);
        proveControl(registry, wallet, key);
        sample(registry);

        assertEq(registry.reserveUnits()[0], 3e8);
    }

    function test_ADepositToAReserveDoesNotInvalidateTheProof() public {
        vm.deal(reserve, 12 ether + 1);
        btc.mint(reserve, 1);
        sample(registry);
        submit(latestRounds());
        assertEq(registry.epochCount(), 1);
    }

    function test_KeepsSubDollarPrices() public {
        usdcFeed.set(99_986_506, block.timestamp);
        (uint256[3] memory prices,) = registry.readPrices();
        assertEq(prices[2], 99_986_506);

        submit(latestRounds());
        assertEq(registry.latestEpoch().assetsUsd, 216_000e8 + 6000 * 99_986_506);
    }

    function test_NormalisesFeedDecimals() public {
        MultiAssetSolvencyRegistry.Asset[] memory wide = assets;
        wide[1].feed = address(new MockAggregator(18, 3_000e18));
        MultiAssetSolvencyRegistry other = new MultiAssetSolvencyRegistry(
            company, auditor, wide, address(verifier), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory
        );

        (uint256[3] memory prices,) = other.readPrices();
        assertEq(prices[1], 3_000e8);
    }

    function test_StalenessIsJudgedPerFeed() public {
        vm.warp(block.timestamp + 2 hours);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        registry.readPrices();

        vm.warp(block.timestamp + 23 hours);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.readPrices();
    }

    function test_PinnedRoundsSurviveAFeedUpdate() public {
        uint80[3] memory pinned = latestRounds();
        btcFeed.set(59_000e8, block.timestamp);

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

    function test_FundsBorrowedForTheSubmissionDoNotCount() public {
        vm.deal(reserve, 2 ether);
        sample(registry);
        vm.deal(reserve, 1_000 ether);

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 1, 2e8, 12e8));
        registry.submitEpoch(proof, rootHash, floors, roundIds);
    }

    function test_SubmissionNeedsASampleFromAnEarlierBlock() public {
        vm.prank(auditor);
        registry.sampleReserves();

        uint80[3] memory roundIds = latestRounds();
        vm.prank(company);
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
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
