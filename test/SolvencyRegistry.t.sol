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
        registry.submitEpoch(123, 49550);

        (
            uint256 rootHash,
            uint256 totalLiabilities,
            uint64 timestamp
        ) = registry.currentEpoch();

        assertEq(rootHash, 123);
        assertEq(totalLiabilities, 49550);
        assertEq(timestamp, block.timestamp);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not owner");
        registry.submitEpoch(123, 49550);
    }
}
