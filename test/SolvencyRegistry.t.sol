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
    uint256 totalLiabilities;

    function setUp() public {
        address[] memory reserves = new address[](2);
        reserves[0] = reserve1;
        reserves[1] = reserve2;
        registry = new SolvencyRegistry(reserves, address(new HonkVerifier()));

        vm.deal(reserve1, 30000);
        vm.deal(reserve2, 20000);

        string memory json = vm.readFile("fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");
        proof = vm.readFileBinary("fixtures/proof.bin");
    }

    function test_SubmitEpoch() public {
        registry.submitEpoch(proof, rootHash, totalLiabilities);

        (
            uint256 storedHash,
            uint256 storedLiabilities,
            uint64 timestamp
        ) = registry.currentEpoch();

        assertEq(storedHash, rootHash);
        assertEq(storedLiabilities, totalLiabilities);
        assertEq(timestamp, block.timestamp);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not owner");
        registry.submitEpoch(proof, rootHash, totalLiabilities);
    }

    function test_RevertsIfInsolvent() public {
        vm.deal(reserve1, 100);
        vm.deal(reserve2, 100);

        vm.expectRevert("insolvent");
        registry.submitEpoch(proof, rootHash, totalLiabilities);
    }

    // verifier reverts with its own error on a bad proof, not a plain false
    function test_RevertsForInvalidProof() public {
        bytes memory garbage = new bytes(proof.length);
        vm.expectRevert();
        registry.submitEpoch(garbage, rootHash, totalLiabilities);
    }

    function test_RevertsForWrongPublicInputs() public {
        vm.expectRevert();
        registry.submitEpoch(proof, rootHash, totalLiabilities + 1);
    }
}
