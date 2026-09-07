// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";

contract SolvencyRegistryTest is Test {
    SolvencyRegistry registry;

    function setUp() public {
        registry = new SolvencyRegistry();
    }

    function test_SubmitEpoch() public {
        string memory json = vm.readFile("fixtures/epoch.json");
        uint256 rootHash = vm.parseJsonUint(json, ".rootHash");
        uint256 totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");

        registry.submitEpoch(rootHash, totalLiabilities);

        (uint256 storedHash, uint256 storedLiabilities, uint64 timestamp) = registry.currentEpoch();

        assertEq(storedHash, rootHash);
        assertEq(storedLiabilities, totalLiabilities);
        assertEq(timestamp, block.timestamp);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not owner");
        registry.submitEpoch(123, 49550);
    }
}
