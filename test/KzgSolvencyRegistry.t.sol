// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";

/**
 * Runs against the commitments and openings `script/commit.ts` actually
 * produced. The pairing equation here and the one in `prover/kzg/commit.ts` are
 * the same equation written twice, in Solidity and in TypeScript; these tests
 * are what keeps the two honest about it.
 */
contract KzgSolvencyRegistryTest is Test {
    KzgSolvencyRegistry internal registry;

    uint256 internal constant RESERVE_KEY = 0xA11CE;
    address internal reserve = vm.addr(RESERVE_KEY);

    uint256 internal totalLiabilities;
    uint256[2] internal balanceCommitment;
    uint256[2] internal idCommitment;
    uint256[2] internal grandSumProof;
    bytes32 internal rangeProofHash;

    uint256 internal sampleIndex;
    uint256 internal sampleId;
    uint256 internal sampleBalance;
    uint256[2] internal sampleProof;

    function setUp() public {
        string memory json = vm.readFile("fixtures/kzg-epoch.json");

        registry = new KzgSolvencyRegistry(
            vm.parseJsonUint(json, ".domainSize"),
            vm.parseJsonUint(json, ".omega"),
            vm.parseJsonUint(json, ".domainSizeInverse"),
            _four(vm.parseJsonUintArray(json, ".g2")),
            _four(vm.parseJsonUintArray(json, ".tauG2"))
        );

        totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");
        balanceCommitment = _pair(vm.parseJsonUintArray(json, ".balanceCommitment"));
        idCommitment = _pair(vm.parseJsonUintArray(json, ".idCommitment"));
        grandSumProof = _pair(vm.parseJsonUintArray(json, ".grandSumProof"));
        rangeProofHash = vm.parseJsonBytes32(json, ".rangeProofHash");

        sampleIndex = vm.parseJsonUint(json, ".sample.index");
        sampleId = vm.parseJsonUint(json, ".sample.id");
        sampleBalance = vm.parseJsonUint(json, ".sample.balance");
        sampleProof = _pair(vm.parseJsonUintArray(json, ".sample.proof"));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESERVE_KEY, registry.reserveDigest(reserve));
        registry.addReserve(reserve, abi.encodePacked(r, s, v));
        vm.deal(reserve, 100 ether);
    }

    function _pair(uint256[] memory values) internal pure returns (uint256[2] memory) {
        return [values[0], values[1]];
    }

    function _four(uint256[] memory values) internal pure returns (uint256[4] memory) {
        return [values[0], values[1], values[2], values[3]];
    }

    function _submit() internal {
        registry.submitEpoch(
            balanceCommitment, idCommitment, totalLiabilities, grandSumProof, rangeProofHash
        );
    }

    // --- the grand sum ------------------------------------------------------

    function test_AcceptsTheRealGrandSumOpening() public {
        _submit();

        (,,,, bytes32 storedHash) = registry.currentCommitment();
        assertEq(storedHash, rangeProofHash);
        (, uint256 storedLiabilities,,) = registry.currentEpoch();
        assertEq(storedLiabilities, totalLiabilities);
        assertEq(registry.epochCount(), 1);
    }

    /// The point of the whole branch: shaving the total breaks the pairing.
    function test_RejectsAnUnderstatedTotal() public {
        vm.expectRevert(KzgSolvencyRegistry.InvalidGrandSumProof.selector);
        registry.submitEpoch(
            balanceCommitment, idCommitment, totalLiabilities - 1, grandSumProof, rangeProofHash
        );
    }

    function test_RejectsAnOverstatedTotal() public {
        vm.expectRevert(KzgSolvencyRegistry.InvalidGrandSumProof.selector);
        registry.submitEpoch(
            balanceCommitment, idCommitment, totalLiabilities + 1, grandSumProof, rangeProofHash
        );
    }

    function test_RejectsATamperedOpeningProof() public {
        uint256[2] memory tampered = [grandSumProof[0], grandSumProof[1]];
        tampered[0] += 1;

        vm.expectRevert();
        registry.submitEpoch(
            balanceCommitment, idCommitment, totalLiabilities, tampered, rangeProofHash
        );
    }

    function test_RejectsATotalThatWrapsTheField() public {
        uint256 wrapped = KzgVerifier.FR + totalLiabilities;
        vm.expectRevert(
            abi.encodeWithSelector(KzgSolvencyRegistry.TotalOutOfField.selector, wrapped)
        );
        registry.submitEpoch(
            balanceCommitment, idCommitment, wrapped, grandSumProof, rangeProofHash
        );
    }

    function test_TheUnprovenPathIsDisabled() public {
        vm.expectRevert(KzgSolvencyRegistry.ProofRequired.selector);
        SolvencyRegistry(address(registry)).submitEpoch(1, totalLiabilities);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(SolvencyRegistry.NotOwner.selector);
        _submit();
    }

    function test_AValidOpeningDoesNotOverrideInsolvency() public {
        vm.deal(reserve, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(SolvencyRegistry.Insolvent.selector, 1 ether, totalLiabilities)
        );
        _submit();
    }

    // --- inclusion ----------------------------------------------------------

    function test_ACustomerCanVerifyInclusionOnChain() public {
        _submit();
        assertTrue(registry.verifyInclusion(sampleIndex, sampleId, sampleBalance, sampleProof));
    }

    function test_RejectsAnInflatedBalance() public {
        _submit();
        assertFalse(
            registry.verifyInclusion(sampleIndex, sampleId, sampleBalance + 1, sampleProof)
        );
    }

    function test_RejectsAProofMovedToAnotherIndex() public {
        _submit();
        assertFalse(
            registry.verifyInclusion(
                (sampleIndex + 1) % registry.domainSize(), sampleId, sampleBalance, sampleProof
            )
        );
    }

    function test_RejectsAnIndexOutsideTheDomain() public {
        _submit();
        uint256 size = registry.domainSize();
        vm.expectRevert(
            abi.encodeWithSelector(KzgSolvencyRegistry.IndexOutOfRange.selector, size, size)
        );
        registry.verifyInclusion(size, sampleId, sampleBalance, sampleProof);
    }

    /// The challenge must be the same one the prover derived, or nothing works.
    function test_TheInclusionChallengeMatchesTheProver() public {
        _submit();
        uint256 onChain = registry.inclusionChallenge(sampleIndex, sampleId, sampleBalance);
        assertLt(onChain, KzgVerifier.FR);
        assertTrue(registry.verifyInclusion(sampleIndex, sampleId, sampleBalance, sampleProof));
    }
}
