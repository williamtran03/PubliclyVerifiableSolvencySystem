// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";

contract SolvencyRegistryTest is Test {
    SolvencyRegistry registry;
    address reserve1 = address(0x1);
    address reserve2 = address(0x2);

    function setUp() public {
        address[] memory reserves = new address[](2);
        reserves[0] = reserve1;
        reserves[1] = reserve2;
        registry = new SolvencyRegistry(reserves);

        vm.deal(reserve1, 30000);
        vm.deal(reserve2, 20000);
    }

    function test_SubmitEpoch() public {
        string memory json = vm.readFile("fixtures/epoch.json");
        uint256 rootHash = vm.parseJsonUint(json, ".rootHash");
        uint256 totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");

        registry.submitEpoch(rootHash, totalLiabilities);

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
        registry.submitEpoch(123, 49550);
    }

    function test_RevertsIfInsolvent() public {
        vm.deal(reserve1, 100);
        vm.deal(reserve2, 100);

        vm.expectRevert("insolvent");
        registry.submitEpoch(123, 49550);
    }
}
