// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HonkVerifier} from "../contracts/HonkVerifier.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";
import {ISolvencyVerifier, ZkSolvencyRegistry} from "../contracts/ZkSolvencyRegistry.sol";

/**
 * Runs against the proof `script/prove.ts` actually produced, not a stub. If
 * the circuit, the prover, or the verification key drift apart, these fail.
 */
contract ZkSolvencyRegistryTest is Test {
    ZkSolvencyRegistry internal registry;

    uint256 internal constant RESERVE_KEY = 0xA11CE;
    address internal reserve = vm.addr(RESERVE_KEY);

    uint256 internal rootHash;
    uint256 internal totalLiabilities;
    bytes internal proof;

    function setUp() public {
        registry = new ZkSolvencyRegistry(ISolvencyVerifier(address(new HonkVerifier())));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESERVE_KEY, registry.reserveDigest(reserve));
        registry.addReserve(reserve, abi.encodePacked(r, s, v));
        vm.deal(reserve, 100 ether);

        string memory json = vm.readFile("fixtures/zk-proof.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");
        proof = vm.parseJsonBytes(json, ".proof");
    }

    function test_AcceptsTheRealProof() public {
        registry.submitEpoch(rootHash, totalLiabilities, proof);

        (uint256 storedHash, uint256 storedLiabilities,,) = registry.currentEpoch();
        assertEq(storedHash, rootHash);
        assertEq(storedLiabilities, totalLiabilities);
        assertEq(registry.epochCount(), 1);
    }

    function test_TheFixtureMatchesTheProversEpoch() public view {
        string memory epoch = vm.readFile("fixtures/epoch.json");
        assertEq(vm.parseJsonUint(epoch, ".rootHash"), rootHash);
        assertEq(vm.parseJsonUint(epoch, ".totalLiabilities"), totalLiabilities);
    }

    function test_RejectsAProofForADifferentRoot() public {
        vm.expectRevert();
        registry.submitEpoch(rootHash + 1, totalLiabilities, proof);
    }

    /// The whole point: a smaller total does not go through just because the
    /// custodian says so.
    function test_RejectsAnUnderstatedTotal() public {
        vm.expectRevert();
        registry.submitEpoch(rootHash, totalLiabilities - 1 ether, proof);
    }

    function test_RejectsATamperedProof() public {
        bytes memory tampered = proof;
        tampered[64] = bytes1(uint8(tampered[64]) ^ 0x01);

        vm.expectRevert();
        registry.submitEpoch(rootHash, totalLiabilities, tampered);
    }

    function test_RejectsAnEmptyProof() public {
        vm.expectRevert();
        registry.submitEpoch(rootHash, totalLiabilities, "");
    }

    function test_TheUnprovenPathIsDisabled() public {
        vm.expectRevert(ZkSolvencyRegistry.ProofRequired.selector);
        SolvencyRegistry(address(registry)).submitEpoch(rootHash, totalLiabilities);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(SolvencyRegistry.NotOwner.selector);
        registry.submitEpoch(rootHash, totalLiabilities, proof);
    }

    /// A valid proof says the tree is honest. It says nothing about the assets.
    function test_AValidProofDoesNotOverrideInsolvency() public {
        vm.deal(reserve, 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(SolvencyRegistry.Insolvent.selector, 1 ether, totalLiabilities)
        );
        registry.submitEpoch(rootHash, totalLiabilities, proof);
    }
}
