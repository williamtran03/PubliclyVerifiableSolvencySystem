// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {MerkleSumRegistry} from "../contracts/MerkleSumRegistry.sol";
contract MerkleSumRegistryTest is Test {
    MerkleSumRegistry registry;
    function setUp() public {
        address[] memory reserves = new address[](1);
        reserves[0] = address(0x1234);
        vm.deal(reserves[0], 120);
        registry = new MerkleSumRegistry(reserves);
    }
    function inputs() internal pure returns (uint256[] memory ids, uint256[] memory amounts) {
        ids = new uint256[](3); amounts = new uint256[](3);
        ids[0] = 1; ids[1] = 2; ids[2] = 3;
        amounts[0] = 40; amounts[1] = 60; amounts[2] = 20;
    }
    function test_ComputesAndStoresRoot() public {
        (uint256[] memory ids, uint256[] memory amounts) = inputs();
        (uint256 root, uint256 sum) = registry.computeRoot(ids, amounts);
        uint256 left = uint256(keccak256(abi.encode(keccak256(abi.encode(uint256(1), uint256(40))), uint256(40), keccak256(abi.encode(uint256(2), uint256(60))), uint256(60))));
        uint256 right = uint256(keccak256(abi.encode(keccak256(abi.encode(uint256(3), uint256(20))), uint256(20), keccak256(abi.encode(uint256(0), uint256(0))), uint256(0))));
        assertEq(root, uint256(keccak256(abi.encode(left, uint256(100), right, uint256(20)))));
        assertEq(sum, 120);
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
        (uint256 storedRoot, uint256 storedSum,) = registry.currentEpoch();
        assertEq(storedRoot, root); assertEq(storedSum, sum);
        assertEq(registry.epochCount(), 1);
    }
    function test_RejectsLegacyRoute() public {
        vm.expectRevert("use submitLedger"); registry.submitEpoch(123, 1);
    }
    function test_RejectsReplayAndNonOwner() public {
        (uint256[] memory ids, uint256[] memory amounts) = inputs();
        registry.submitLedger(bytes32(uint256(1)), ids, amounts);
        vm.expectRevert("invalid snapshot"); registry.submitLedger(bytes32(uint256(1)), ids, amounts);
        vm.prank(address(0xBEEF)); vm.expectRevert("not owner"); registry.submitLedger(bytes32(uint256(2)), ids, amounts);
    }
    function test_RejectsInsolvencyOverflowAndInvalidLength() public {
        (uint256[] memory ids, uint256[] memory amounts) = inputs();
        amounts[0] = 41;
        vm.expectRevert("insolvent"); registry.submitLedger(bytes32(uint256(1)), ids, amounts);
        amounts[0] = type(uint256).max;
        vm.expectRevert(); registry.computeRoot(ids, amounts);
        vm.expectRevert("invalid length"); registry.computeRoot(ids, new uint256[](0));
        vm.expectRevert("invalid length"); registry.computeRoot(new uint256[](257), new uint256[](257));
    }
    function test_RejectsDuplicateReserves() public {
        address[] memory reserves = new address[](2); reserves[0] = address(1); reserves[1] = address(1);
        vm.expectRevert("duplicate reserve"); new MerkleSumRegistry(reserves);
    }
}
