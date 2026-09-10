// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";
import {HonkVerifier} from "../contracts/HonkVerifier.sol";

contract SolvencyRegistryTest is Test {
    SolvencyRegistry registry;
    address reserve1 = address(0x1);
    address reserve2 = address(0x2);
    bytes proof;
    uint256 rootHash;

    // The proof in fixtures/ was generated against this assets figure (ASSETS
    // in prover/buildTree.ts), so the reserves here have to add up to it.
    uint256 constant PROVEN_ASSETS = 50000;

    function setUp() public {
        address[] memory reserves = new address[](2);
        reserves[0] = reserve1;
        reserves[1] = reserve2;
        registry = new SolvencyRegistry(reserves, address(new HonkVerifier()));

        vm.deal(reserve1, 30000);
        vm.deal(reserve2, 20000);

        string memory json = vm.readFile("fixtures/single-asset/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        proof = vm.readFileBinary("fixtures/single-asset/proof.bin");
    }

    function test_SubmitEpoch() public {
        registry.submitEpoch(proof, rootHash);

        (uint256 storedHash, uint256 storedReserves, uint64 timestamp) = registry.currentEpoch();

        assertEq(storedHash, rootHash);
        assertEq(storedReserves, PROVEN_ASSETS);
        assertEq(timestamp, block.timestamp);
    }

    /// The epoch stores the root and the reserves only - the liabilities total
    /// never reaches the chain, which is the point of proving the inequality
    /// inside the circuit rather than checking it here.
    function test_DoesNotPublishLiabilities() public {
        registry.submitEpoch(proof, rootHash);

        string memory json = vm.readFile("fixtures/single-asset/epoch.json");
        uint256 actualLiabilities = vm.parseJsonUint(json, ".totalLiabilities");

        (, uint256 storedReserves,) = registry.currentEpoch();
        assertTrue(storedReserves >= actualLiabilities);
        assertTrue(storedReserves != actualLiabilities);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not owner");
        registry.submitEpoch(proof, rootHash);
    }

    /// Insolvency is now caught by the proof itself: the contract feeds its own
    /// reserves in as a public input, so draining them makes the proof invalid
    /// rather than tripping a separate require.
    function test_RevertsIfReservesNoLongerMatchTheProof() public {
        vm.deal(reserve1, 100);
        vm.deal(reserve2, 100);

        vm.expectRevert();
        registry.submitEpoch(proof, rootHash);
    }

    function test_RevertsForInvalidProof() public {
        bytes memory garbage = new bytes(proof.length);
        vm.expectRevert();
        registry.submitEpoch(garbage, rootHash);
    }

    function test_RevertsForWrongRoot() public {
        vm.expectRevert();
        registry.submitEpoch(proof, rootHash + 1);
    }
}
