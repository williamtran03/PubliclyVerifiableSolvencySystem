// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {MinimumTree} from "../contracts/MinimumTree.sol";
import {SnapshotOracle} from "../contracts/SnapshotOracle.sol";

contract TreeHarness {
    function root(bytes32[] memory ids, uint256[] memory sums) external pure returns (bytes32, uint256) {
        return MinimumTree.root(bytes32(uint256(1)), 4, ids, sums);
    }
}

contract MinimumTreeTest is Test {
    function test_SharedTypeScriptFixture() public view {
        string memory f = vm.readFile("fixtures/minimum-hashes.json");
        bytes32 snapshot = vm.parseJsonBytes32(f, ".snapshot");
        bytes32 identity = MinimumTree.identity(
            snapshot,
            "synthetic-fixture",
            "2000-01-01",
            0,
            vm.parseJsonBytes32(f, ".salt"),
            vm.parseJsonBytes32(f, ".nonce")
        );
        assertEq(identity, vm.parseJsonBytes32(f, ".identity"));
        uint256 amount = vm.parseJsonUint(f, ".amount");
        uint256 second = vm.parseJsonUint(f, ".secondAmount");
        bytes32 leaf = MinimumTree.balance(snapshot, 0, amount);
        assertEq(leaf, vm.parseJsonBytes32(f, ".leaf"));
        bytes32 pair = MinimumTree.pair(identity, leaf, amount);
        assertEq(pair, vm.parseJsonBytes32(f, ".pair"));
        bytes32 secondId = vm.parseJsonBytes32(f, ".secondIdentity");
        bytes32 parent = MinimumTree.parent(
            pair, amount, MinimumTree.pair(secondId, MinimumTree.balance(snapshot, 1, second), second), second
        );
        assertEq(parent, vm.parseJsonBytes32(f, ".parent"));
    }

    function test_SharedRootAndPadding() public view {
        string memory f = vm.readFile("fixtures/minimum-hashes.json");
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = vm.parseJsonBytes32(f, ".identity");
        ids[1] = vm.parseJsonBytes32(f, ".secondIdentity");
        uint256[] memory sums = new uint256[](2);
        sums[0] = vm.parseJsonUint(f, ".amount");
        sums[1] = vm.parseJsonUint(f, ".secondAmount");
        (bytes32 root, uint256 total) = MinimumTree.root(vm.parseJsonBytes32(f, ".snapshot"), 4, ids, sums);
        assertEq(root, vm.parseJsonBytes32(f, ".root"));
        assertEq(total, vm.parseJsonUint(f, ".rootSum"));
    }

    function test_SharedManifest() public view {
        string memory f = vm.readFile("fixtures/minimum-hashes.json");
        bytes32 snapshot = vm.parseJsonBytes32(f, ".snapshot");
        SnapshotOracle.Rate[] memory rates = new SnapshotOracle.Rate[](1);
        rates[0] = SnapshotOracle.Rate(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, address(0x10), 18, 8, 2000e8, 1, 990);
        assertEq(
            keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), snapshot, rates)),
            vm.parseJsonBytes32(f, ".rateManifestHash")
        );
    }

    function testFuzz_RootSum(uint128 a, uint128 b) public pure {
        a = uint128(bound(a, 1, type(uint128).max));
        b = uint128(bound(b, 1, type(uint128).max));
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = bytes32(uint256(1));
        ids[1] = bytes32(uint256(2));
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
        (, uint256 sum) = MinimumTree.root(bytes32(uint256(1)), 4, ids, amounts);
        assertEq(sum, uint256(a) + b);
    }

    function test_OverflowAndDuplicateIdentities() public {
        TreeHarness h = new TreeHarness();
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = bytes32(uint256(1));
        ids[1] = bytes32(uint256(2));
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = type(uint256).max;
        amounts[1] = 1;
        vm.expectRevert();
        h.root(ids, amounts);
        amounts[0] = 1;
        ids[1] = ids[0];
        vm.expectRevert();
        h.root(ids, amounts);
    }
}
