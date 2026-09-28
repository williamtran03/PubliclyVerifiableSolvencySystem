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

    uint256 constant PROVEN_ASSETS = 50000;

    function setUp() public {
        address[] memory reserves = new address[](2);
        reserves[0] = reserve1;
        reserves[1] = reserve2;
        registry = new SolvencyRegistry(reserves, address(new HonkVerifier()));

        vm.deal(reserve1, 30000);
        vm.deal(reserve2, 20000);

        string memory json = vm.readFile("arms/single-asset/fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        proof = vm.readFileBinary("arms/single-asset/fixtures/proof.bin");
    }

    function test_SubmitEpoch() public {
        registry.submitEpoch(proof, rootHash);

        (uint256 storedHash, uint256 storedReserves, uint64 timestamp) = registry.currentEpoch();

        assertEq(storedHash, rootHash);
        assertEq(storedReserves, PROVEN_ASSETS);
        assertEq(timestamp, block.timestamp);
    }

    function test_GasForPreparedSubmission() public {
        bytes memory payload = abi.encodeCall(registry.submitEpoch, (proof, rootHash));
        address target = address(registry);
        uint256 before = gasleft();
        (bool ok,) = target.call(payload);
        uint256 used = before - gasleft();
        assertTrue(ok, "the committed proof over shared/customers.csv must verify");
        emit log_named_uint("single-asset prepared submitEpoch gas", used);
        emit log_named_uint("single-asset submitEpoch calldata bytes", payload.length);
    }

    function test_GasForPreparedVerification() public {
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = bytes32(PROVEN_ASSETS);
        publicInputs[1] = bytes32(rootHash);
        bytes memory payload = abi.encodeCall(registry.verifier().verify, (proof, publicInputs));
        address target = address(registry.verifier());
        uint256 before = gasleft();
        (bool ok, bytes memory result) = target.staticcall(payload);
        uint256 used = before - gasleft();
        assertTrue(ok && abi.decode(result, (bool)), "the committed proof over shared/customers.csv must verify");
        emit log_named_uint("single-asset prepared HonkVerifier.verify gas", used);
    }

    function test_DoesNotPublishLiabilities() public {
        registry.submitEpoch(proof, rootHash);

        string memory json = vm.readFile("arms/single-asset/fixtures/epoch.json");
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
