// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {MinimumSolvencyRegistry} from "../contracts/MinimumSolvencyRegistry.sol";
import {AuditedAssets} from "../contracts/AuditedAssets.sol";
import {SnapshotOracle} from "../contracts/SnapshotOracle.sol";
import {MockOracle} from "../contracts/mocks/MockOracle.sol";

contract MinimumSolvencyRegistryTest is Test {
    MinimumSolvencyRegistry r;
    MockOracle feed;
    address auditor = address(2);
    address reserve = address(3);
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function setUp() public {
        vm.warp(1000);
        vm.roll(10);
        feed = new MockOracle(8);
        feed.setRound(1, 2000e8, 990);
        r = new MinimumSolvencyRegistry(address(this), auditor, 4, 60);
        r.addAsset(NATIVE, reserve, address(feed), true);
        vm.prank(reserve);
        r.verifyAsset(1, 1100, "");
        vm.prank(auditor);
        r.approveAsset(1, true);
    }

    function inputs(bytes32 id, uint256 amount)
        internal
        view
        returns (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        )
    {
        ids = new bytes32[](1);
        ids[0] = bytes32(uint256(123));
        amounts = new uint256[](1);
        amounts[0] = amount;
        rates = new SnapshotOracle.Rate[](1);
        rates[0] = SnapshotOracle.Rate(NATIVE, address(feed), 18, 8, 2000e8, 1, 990);
        (bytes32 root, uint256 total) = r.computeRoot(id, ids, amounts);
        s = MinimumSolvencyRegistry.SnapshotInput(
            id, root, total, keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), id, rates)), 1000, 9
        );
    }

    function submit(bytes32 id, uint256 amount) internal {
        (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        ) = inputs(id, amount);
        r.addLiability(s, ids, amounts, rates);
        vm.prank(auditor);
        r.verifyAddLiability(id, true);
    }

    function propose(bytes32 id, uint256 amount) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        r.proposeClaim(id, ids, amounts);
    }

    function test_FinalizeClaimAndGetters() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 100e8);
        propose(id, 1 ether);
        vm.prank(auditor);
        r.finalizeClaim(id, true);
        MinimumSolvencyRegistry.Claim memory c = r.currentClaim();
        assertEq(c.totalEligibleAssetsUsd, 2000e8);
        assertEq(c.totalLiabilitiesUsd, 100e8);
        assertEq(c.surplus, 1900e8);
        assertEq(c.snapshotTime, 1000);
        assertEq(c.snapshotBlock, 9);
        assertEq(c.submittedAt, 1000);
        assertEq(c.finalizedAt, 1000);
        assertEq(c.liabilityVerifiedAt, 1000);
        assertEq(c.verifiedBy, auditor);
        assertEq(r.getRates(id)[0].roundId, 1);
        assertEq(r.getClaimAssets(id)[0].rawAmount, 1 ether);
        assertEq(r.getClaimProposal(id).assetIds.length, 1);
        assertEq(r.snapshotCount(), 1);
        assertEq(r.snapshotIds(0), id);
        assertEq(r.getLiability(id).rootSum, 100e8);
        assertEq(r.auditor(), auditor);
    }

    function test_RejectInsolventStaleAndOverflow() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 2001e8);
        propose(id, 1 ether);
        vm.prank(auditor);
        vm.expectRevert(MinimumSolvencyRegistry.Insolvent.selector);
        r.finalizeClaim(id, true);
        assertFalse(r.getClaimProposal(id).decided);
        vm.warp(1100);
        vm.prank(auditor);
        vm.expectRevert();
        r.finalizeClaim(id, true);
    }

    function test_Overflow() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 1);
        propose(id, type(uint256).max);
        vm.prank(auditor);
        vm.expectRevert();
        r.finalizeClaim(id, true);
    }

    function test_LiabilityApprovalRejectionReplayAndRemoval() public {
        bytes32 id = bytes32(uint256(1));
        (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        ) = inputs(id, 1);
        r.addLiability(s, ids, amounts, rates);
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
        r.removeLiability(id);
        vm.prank(auditor);
        r.verifyRemoveLiability(id, false);
        vm.prank(auditor);
        r.verifyAddLiability(id, false);
        assertEq(uint256(r.getLiability(id).status), 3);
        bytes32 second = bytes32(uint256(2));
        submit(second, 1);
        r.removeLiability(second);
        vm.prank(auditor);
        r.verifyRemoveLiability(second, true);
        assertEq(uint256(r.getLiability(second).status), 4);
    }

    function test_PendingLiabilityRemoval() public {
        (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        ) = inputs(bytes32(uint256(1)), 1);
        r.addLiability(s, ids, amounts, rates);
        r.removeLiability(s.id);
        vm.prank(auditor);
        r.verifyRemoveLiability(s.id, true);
        vm.prank(auditor);
        vm.expectRevert();
        r.verifyAddLiability(s.id, true);
    }

    function test_RejectWrongRootSumManifestDecimalsAndOracle() public {
        (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        ) = inputs(bytes32(uint256(1)), 1);
        s.rootHash = bytes32(0);
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
        (s,,,) = inputs(bytes32(uint256(1)), 1);
        s.totalLiabilitiesUsd++;
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
        (s,,,) = inputs(bytes32(uint256(1)), 1);
        rates[0].tokenDecimals = 17;
        s.rateManifestHash = keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), s.id, rates));
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
        rates[0].tokenDecimals = 18;
        rates[0].rate = 1;
        s.rateManifestHash = keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), s.id, rates));
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
    }

    function test_UnauthorizedLiabilityAndClaimCalls() public {
        bytes32 id = bytes32(uint256(1));
        (
            MinimumSolvencyRegistry.SnapshotInput memory s,
            bytes32[] memory ids,
            uint256[] memory amounts,
            SnapshotOracle.Rate[] memory rates
        ) = inputs(id, 1);
        vm.prank(reserve);
        vm.expectRevert();
        r.addLiability(s, ids, amounts, rates);
        submit(id, 1);
        vm.expectRevert();
        r.verifyAddLiability(id, true);
        vm.prank(reserve);
        vm.expectRevert();
        r.removeLiability(id);
        vm.expectRevert();
        r.verifyRemoveLiability(id, true);
        vm.prank(reserve);
        vm.expectRevert();
        r.proposeClaim(id, new uint256[](0), new uint256[](0));
        propose(id, 1 ether);
        vm.expectRevert();
        r.finalizeClaim(id, true);
    }

    function test_RejectionAndRepeatedClaimFail() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 1);
        propose(id, 1 ether);
        vm.prank(auditor);
        r.finalizeClaim(id, false);
        assertFalse(r.getClaim(id).finalized);
        vm.prank(auditor);
        vm.expectRevert();
        r.finalizeClaim(id, true);
        vm.expectRevert();
        propose(id, 1 ether);
    }

    function test_PendingRemovalBlocksFinalization() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 1);
        propose(id, 1 ether);
        r.removeAsset(1);
        vm.prank(auditor);
        vm.expectRevert();
        r.finalizeClaim(id, true);
    }

    function test_PreservesHistoryAfterRetirement() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 1);
        propose(id, 1 ether);
        vm.prank(auditor);
        r.finalizeClaim(id, true);
        r.removeAsset(1);
        vm.prank(auditor);
        r.verifyRemoveAsset(1, true);
        r.removeLiability(id);
        vm.prank(auditor);
        r.verifyRemoveLiability(id, true);
        assertTrue(r.getClaim(id).finalized);
        assertEq(r.getClaimAssets(id)[0].usd, 2000e8);
    }

    function testFuzz_Solvency(uint96 raw, uint96 liability) public {
        raw = uint96(bound(raw, 0, 1e24));
        liability = uint96(bound(liability, 1, 1e24));
        bytes32 id = bytes32(uint256(1));
        submit(id, liability);
        propose(id, raw);
        vm.prank(auditor);
        uint256 assets = uint256(raw) * 2000e8 * 1e8 / 1e26;
        if (assets < liability) vm.expectRevert(MinimumSolvencyRegistry.Insolvent.selector);
        r.finalizeClaim(id, true);
        if (assets >= liability) assertEq(r.getClaim(id).surplus, assets - liability);
    }

    function testFuzz_TimestampFreshness(uint32 delay) public {
        delay = uint32(bound(delay, 0, 1000));
        bytes32 id = bytes32(uint256(1));
        submit(id, 1);
        propose(id, 1 ether);
        vm.warp(1000 + delay);
        vm.prank(auditor);
        if (delay > 50) vm.expectRevert();
        r.finalizeClaim(id, true);
    }

    function test_FinalizationEvent() public {
        bytes32 id = bytes32(uint256(1));
        submit(id, 100e8);
        propose(id, 1 ether);
        vm.expectEmit(true, false, false, true);
        emit MinimumSolvencyRegistry.ClaimFinalized(id, 2000e8, 100e8, 1900e8, auditor);
        vm.prank(auditor);
        r.finalizeClaim(id, true);
    }
}
