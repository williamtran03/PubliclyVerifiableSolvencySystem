// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {SnapshotOracle} from "../contracts/SnapshotOracle.sol";
import {MockOracle} from "../contracts/mocks/MockOracle.sol";

contract OracleHarness {
    function validate(SnapshotOracle.Rate memory r, uint256 time, uint256 maxAge) external view {
        SnapshotOracle.validate(r, time, maxAge);
    }

    function usd(uint256 raw, SnapshotOracle.Rate memory r) external pure returns (uint256) {
        return SnapshotOracle.usd(raw, r);
    }
}

contract DecimalToken {
    uint8 public immutable decimals;

    constructor(uint8 value) {
        decimals = value;
    }
}

contract SnapshotOracleTest is Test {
    MockOracle feed;
    OracleHarness h;

    function setUp() public {
        vm.warp(1000);
        feed = new MockOracle(8);
        feed.setRound(1, 2000e8, 990);
        h = new OracleHarness();
    }

    function rate() internal view returns (SnapshotOracle.Rate memory) {
        return SnapshotOracle.Rate(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, address(feed), 18, 8, 2000e8, 1, 990);
    }

    function test_NativeAndTokenNormalization() public {
        SnapshotOracle.Rate memory r = rate();
        h.validate(r, 1000, 60);
        assertEq(h.usd(1 ether, r), 2000e8);
        DecimalToken token = new DecimalToken(6);
        r.token = address(token);
        r.tokenDecimals = 6;
        h.validate(r, 1000, 60);
        assertEq(h.usd(1e6, r), 2000e8);
    }

    function test_RejectNonpositiveAndMissingRounds() public {
        SnapshotOracle.Rate memory r = rate();
        r.rate = 0;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r = rate();
        r.roundId = 0;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r.roundId = 2;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        feed.setRound(2, -1, 990);
        vm.expectRevert();
        h.validate(r, 1000, 60);
    }

    function test_RejectFeedDecimalTokenDecimalAndZeroAddress() public {
        SnapshotOracle.Rate memory r = rate();
        r.oracleDecimals = 7;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r = rate();
        r.tokenDecimals = 19;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r = rate();
        r.token = address(0);
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r = rate();
        r.feed = address(0);
        vm.expectRevert();
        h.validate(r, 1000, 60);
    }

    function test_RejectTimestampMismatchStaleFutureAndOverflow() public {
        SnapshotOracle.Rate memory r = rate();
        r.updatedAt = 989;
        vm.expectRevert();
        h.validate(r, 1000, 60);
        r = rate();
        vm.expectRevert();
        h.validate(r, 989, 60);
        vm.warp(1100);
        vm.expectRevert();
        h.validate(r, 1000, 60);
        vm.expectRevert();
        h.usd(type(uint256).max, r);
    }

    function testFuzz_AssetAmountsRoundDown(uint128 amount) public view {
        SnapshotOracle.Rate memory r = rate();
        assertEq(h.usd(amount, r), uint256(amount) * 2000e8 * 1e8 / 1e26);
    }
}
