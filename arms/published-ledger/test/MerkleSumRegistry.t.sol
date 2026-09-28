// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleSumRegistry} from "../contracts/MerkleSumRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";
import {MockToken} from "../contracts/mocks/MockToken.sol";

contract MerkleSumRegistryTest is Test {
    MerkleSumRegistry registry;
    ReserveDirectory directory;
    MockToken token;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;
    uint256 reserveKey;

    uint64 constant MAX_EPOCH_AGE = 1 days;
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");
        token = new MockToken();
        directory = new ReserveDirectory();
        registry = new MerkleSumRegistry(company, auditor, tokens(), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory);

        vm.deal(reserve, 120);
        token.mint(reserve, 5);
        vm.prank(company);
        registry.proposeReserve(reserve);
        proveControl();
        vm.prank(auditor);
        registry.reviewReserve(reserve, true);
        sample();
    }

    function tokens() internal view returns (address[] memory list) {
        list = new address[](2);
        list[1] = address(token);
    }

    function proveControl() internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reserveKey, registry.reserveDigest(reserve));
        registry.proveReserve(reserve, abi.encodePacked(r, s, v));
    }

    function sample() internal {
        vm.prank(auditor);
        registry.sampleReserves();
        vm.roll(block.number + 1);
    }

    function nextWindow() internal {
        vm.warp(block.timestamp + MIN_EPOCH_INTERVAL);
        proveControl();
        sample();
    }

    function inputs() internal pure returns (uint256[][] memory ids, uint256[][] memory amounts) {
        ids = new uint256[][](2);
        amounts = new uint256[][](2);
        ids[0] = new uint256[](3);
        amounts[0] = new uint256[](3);
        (ids[0][0], ids[0][1], ids[0][2]) = (1, 2, 3);
        (amounts[0][0], amounts[0][1], amounts[0][2]) = (40, 60, 20);
        ids[1] = new uint256[](1);
        amounts[1] = new uint256[](1);
        (ids[1][0], amounts[1][0]) = (4, 5);
    }

    function submit(bytes32 snapshotId, uint256[][] memory ids, uint256[][] memory amounts) internal {
        vm.prank(company);
        registry.submitLedger(snapshotId, ids, amounts);
    }

    function test_ComputesAndStoresOneRootPerAsset() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        (uint256 root, uint256 sum) = registry.computeRoot(ids[0], amounts[0]);
        uint256 left = uint256(
            keccak256(
                abi.encode(
                    keccak256(abi.encode(uint256(1), uint256(40))),
                    uint256(40),
                    keccak256(abi.encode(uint256(2), uint256(60))),
                    uint256(60)
                )
            )
        );
        uint256 right = uint256(
            keccak256(
                abi.encode(
                    keccak256(abi.encode(uint256(3), uint256(20))),
                    uint256(20),
                    keccak256(abi.encode(uint256(0), uint256(0))),
                    uint256(0)
                )
            )
        );
        assertEq(root, uint256(keccak256(abi.encode(left, uint256(100), right, uint256(20)))));
        assertEq(sum, 120);

        submit(bytes32(uint256(1)), ids, amounts);
        MerkleSumRegistry.Epoch memory epoch = registry.latestEpoch();
        assertEq(epoch.rootHashes[0], root);
        assertEq(epoch.liabilities[0], 120);
        assertEq(epoch.liabilities[1], 5);
        assertEq(epoch.reserves[1], 5);
        assertEq(registry.epochCount(), 1);
    }

    function test_KeepsEveryEpoch() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        submit(bytes32(uint256(1)), ids, amounts);
        amounts[0][0] = 30;
        nextWindow();
        submit(bytes32(uint256(2)), ids, amounts);
        assertEq(registry.getEpoch(0).liabilities[0], 120);
        assertEq(registry.getEpoch(1).liabilities[0], 110);
    }

    function test_AnAssetNobodyHoldsHasAnEmptyLedger() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        ids[1] = new uint256[](0);
        amounts[1] = new uint256[](0);
        submit(bytes32(uint256(1)), ids, amounts);
        assertEq(registry.latestEpoch().rootHashes[1], 0);
        assertEq(registry.latestEpoch().liabilities[1], 0);
    }

    function test_RejectsAShortfallInOneAssetEvenIfAnotherHasSurplus() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        vm.deal(reserve, 1 ether);
        sample();
        amounts[1][0] = 6;
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MerkleSumRegistry.Insolvent.selector, 1, 5, 6));
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
    }

    function test_UnapprovedReservesDoNotCount() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        vm.prank(auditor);
        registry.removeReserve(reserve);
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MerkleSumRegistry.Insolvent.selector, 0, 0, 120));
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
    }

    function test_RejectsReplayAndNonCompany() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        submit(bytes32(uint256(1)), ids, amounts);
        nextWindow();
        vm.prank(company);
        vm.expectRevert(MerkleSumRegistry.InvalidSnapshot.selector);
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
        vm.prank(company);
        vm.expectRevert(MerkleSumRegistry.InvalidSnapshot.selector);
        registry.submitLedger(bytes32(0), ids, amounts);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitLedger(bytes32(uint256(2)), ids, amounts);
    }

    function test_RejectsOverflowAndInvalidLength() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        amounts[0][0] = type(uint256).max;
        vm.expectRevert();
        registry.computeRoot(ids[0], amounts[0]);
        vm.expectRevert(MerkleSumRegistry.InvalidLength.selector);
        registry.computeRoot(ids[0], new uint256[](2));
        vm.expectRevert(MerkleSumRegistry.InvalidLength.selector);
        registry.computeRoot(new uint256[](257), new uint256[](257));

        uint256[][] memory oneAsset = new uint256[][](1);
        vm.prank(company);
        vm.expectRevert(MerkleSumRegistry.InvalidLength.selector);
        registry.submitLedger(bytes32(uint256(1)), oneAsset, oneAsset);
    }

    function test_RejectsBadAssetLists() public {
        address[] memory duplicate = new address[](2);
        vm.expectRevert(MerkleSumRegistry.BadAssets.selector);
        new MerkleSumRegistry(company, auditor, duplicate, MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory);
        vm.expectRevert(MerkleSumRegistry.BadAssets.selector);
        new MerkleSumRegistry(company, auditor, new address[](0), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory);
    }

    function test_ANextLedgerWaitsForTheMinimumInterval() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        submit(bytes32(uint256(1)), ids, amounts);
        uint256 earliest = block.timestamp + MIN_EPOCH_INTERVAL;
        proveControl();
        sample();

        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(ReserveRegistry.EpochTooSoon.selector, earliest));
        registry.submitLedger(bytes32(uint256(2)), ids, amounts);
    }

    function test_ALedgerNeedsAnAuditorSampleFromThisWindow() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        submit(bytes32(uint256(1)), ids, amounts);
        vm.warp(block.timestamp + MIN_EPOCH_INTERVAL);
        proveControl();

        vm.prank(company);
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.submitLedger(bytes32(uint256(2)), ids, amounts);
    }

    function test_FundsBorrowedForTheSubmissionDoNotCount() public {
        (uint256[][] memory ids, uint256[][] memory amounts) = inputs();
        amounts[1][0] = 6;
        token.mint(reserve, 1);

        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(MerkleSumRegistry.Insolvent.selector, 1, 5, 6));
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
    }
}

contract MerkleSumRegistrySharedCustomersTest is Test {
    MerkleSumRegistry registry;
    ReserveDirectory directory;
    MockToken token;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;
    uint256 reserveKey;
    string fixture;

    uint256 constant RESERVE_UNITS = 50_000;
    uint256 constant SHARED_LIABILITIES = 49_550;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");
        token = new MockToken();
        directory = new ReserveDirectory();
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        registry = new MerkleSumRegistry(company, auditor, tokens, 1 days, 1 hours, directory);

        token.mint(reserve, RESERVE_UNITS);
        vm.prank(company);
        registry.proposeReserve(reserve);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reserveKey, registry.reserveDigest(reserve));
        registry.proveReserve(reserve, abi.encodePacked(r, s, v));
        vm.prank(auditor);
        registry.reviewReserve(reserve, true);
        vm.prank(auditor);
        registry.sampleReserves();
        vm.roll(block.number + 1);

        fixture = vm.readFile("arms/published-ledger/fixtures/shared-customers.json");
    }

    function ledger(string memory variant)
        internal
        view
        returns (bytes32 snapshotId, uint256[][] memory ids, uint256[][] memory amounts, uint256 root)
    {
        snapshotId = vm.parseJsonBytes32(fixture, string.concat(".", variant, ".snapshotId"));
        ids = new uint256[][](1);
        amounts = new uint256[][](1);
        ids[0] = vm.parseJsonUintArray(fixture, string.concat(".", variant, ".identities"));
        amounts[0] = vm.parseJsonUintArray(fixture, string.concat(".", variant, ".amounts"));
        root = vm.parseJsonUint(fixture, string.concat(".", variant, ".rootHash"));
    }

    function probeSubmission(string memory variant) internal returns (uint256 used, uint256 calldataBytes) {
        (bytes32 snapshotId, uint256[][] memory ids, uint256[][] memory amounts, uint256 root) = ledger(variant);
        bytes memory payload = abi.encodeCall(registry.submitLedger, (snapshotId, ids, amounts));
        address target = address(registry);
        vm.prank(company);
        uint256 before = gasleft();
        (bool ok,) = target.call(payload);
        used = before - gasleft();
        assertTrue(ok, "the shared-customer ledger must be accepted against 50,000 reserve units");
        calldataBytes = payload.length;
        MerkleSumRegistry.Epoch memory epoch = registry.latestEpoch();
        assertEq(epoch.rootHashes[0], root, "the contract must rebuild the root the TypeScript prover published");
        assertEq(epoch.liabilities[0], SHARED_LIABILITIES, "shared/customers.csv owes 49,550 units");
        assertEq(epoch.reserves[0], RESERVE_UNITS);
    }

    function probeComputeRoot(string memory variant) internal view returns (uint256 used) {
        (, uint256[][] memory ids, uint256[][] memory amounts, uint256 root) = ledger(variant);
        bytes memory payload = abi.encodeCall(registry.computeRoot, (ids[0], amounts[0]));
        address target = address(registry);
        uint256 before = gasleft();
        (bool ok, bytes memory result) = target.staticcall(payload);
        used = before - gasleft();
        assertTrue(ok);
        (uint256 computed, uint256 sum) = abi.decode(result, (uint256, uint256));
        assertEq(computed, root, "the contract must rebuild the root the TypeScript prover published");
        assertEq(sum, SHARED_LIABILITIES, "shared/customers.csv owes 49,550 units");
    }

    function test_GasForSharedCustomersOnePartEach() public {
        (uint256 used, uint256 calldataBytes) = probeSubmission("whole");
        emit log_named_uint("ledger shared-customers submitLedger gas, 3 parts 1 asset", used);
        emit log_named_uint("ledger shared-customers submitLedger calldata bytes, 3 parts", calldataBytes);
    }

    function test_GasForSharedCustomersTwoPartsEach() public {
        (uint256 used, uint256 calldataBytes) = probeSubmission("split");
        emit log_named_uint("ledger shared-customers submitLedger gas, 6 parts 1 asset", used);
        emit log_named_uint("ledger shared-customers submitLedger calldata bytes, 6 parts", calldataBytes);
    }

    function test_GasForSharedCustomersRootOnly() public {
        emit log_named_uint("ledger shared-customers computeRoot gas, 3 parts", probeComputeRoot("whole"));
        emit log_named_uint("ledger shared-customers computeRoot gas, 6 parts", probeComputeRoot("split"));
    }
}
