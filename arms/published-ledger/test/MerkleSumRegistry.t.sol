// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleSumRegistry} from "../contracts/MerkleSumRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {MockToken} from "../contracts/mocks/MockToken.sol";

contract MerkleSumRegistryTest is Test {
    MerkleSumRegistry registry;
    MockToken token;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;

    uint64 constant MAX_EPOCH_AGE = 1 days;

    function setUp() public {
        uint256 key;
        (reserve, key) = makeAddrAndKey("reserve");
        token = new MockToken();
        address[] memory tokens = new address[](2);
        tokens[0] = address(0);
        tokens[1] = address(token);
        registry = new MerkleSumRegistry(company, auditor, tokens, MAX_EPOCH_AGE);

        vm.deal(reserve, 120);
        token.mint(reserve, 5);
        vm.prank(company);
        registry.proposeReserve(reserve);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(reserve, block.timestamp));
        registry.proveReserve(reserve, block.timestamp, abi.encodePacked(r, s, v));
        vm.prank(auditor);
        registry.reviewReserve(reserve, true);
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
        new MerkleSumRegistry(company, auditor, duplicate, MAX_EPOCH_AGE);
        vm.expectRevert(MerkleSumRegistry.BadAssets.selector);
        new MerkleSumRegistry(company, auditor, new address[](0), MAX_EPOCH_AGE);
    }
}
