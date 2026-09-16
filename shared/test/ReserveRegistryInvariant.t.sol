// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReserveRegistry} from "../contracts/ReserveRegistry.sol";

contract InvariantRegistry is ReserveRegistry {
    constructor(address company, address auditor) ReserveRegistry("Registry", company, auditor, 1 days) {}
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract ReserveHandler is Test {
    InvariantRegistry public registry;
    MockToken public token;
    address public company;
    address public auditor;

    address[8] public pool;
    uint256[8] private keys;

    mapping(address => bool) public shouldBeApproved;
    address[] public expected;

    constructor(InvariantRegistry _registry, MockToken _token, address _company, address _auditor) {
        registry = _registry;
        token = _token;
        company = _company;
        auditor = _auditor;
        for (uint256 i = 0; i < 8; i++) {
            (pool[i], keys[i]) = makeAddrAndKey(string.concat("pool", vm.toString(i)));
        }
    }

    function pick(uint256 seed) internal view returns (address wallet, uint256 walletKey) {
        uint256 i = seed % 8;
        return (pool[i], keys[i]);
    }

    function propose(uint256 seed) external {
        (address wallet,) = pick(seed);
        if (registry.reserveStatus(wallet) != ReserveRegistry.ReserveStatus.None) return;
        vm.prank(company);
        registry.proposeReserve(wallet);
    }

    function prove(uint256 seed, uint32 offset) external {
        (address wallet, uint256 walletKey) = pick(seed);
        if (registry.reserveStatus(wallet) != ReserveRegistry.ReserveStatus.Proposed) return;
        uint256 expiry = block.timestamp + uint256(offset);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, registry.reserveDigest(wallet, expiry));
        registry.proveReserve(wallet, expiry, abi.encodePacked(r, s, v));
    }

    function review(uint256 seed, bool approved) external {
        (address wallet,) = pick(seed);
        if (registry.reserveStatus(wallet) != ReserveRegistry.ReserveStatus.Proven) return;
        if (approved && registry.reserveCount() >= registry.MAX_RESERVES()) return;
        vm.prank(auditor);
        registry.reviewReserve(wallet, approved);
        if (approved) {
            shouldBeApproved[wallet] = true;
            expected.push(wallet);
        }
    }

    function remove(uint256 seed, bool asCompany) external {
        (address wallet,) = pick(seed);
        if (registry.reserveStatus(wallet) == ReserveRegistry.ReserveStatus.None) return;
        vm.prank(asCompany ? company : auditor);
        registry.removeReserve(wallet);
        if (shouldBeApproved[wallet]) {
            shouldBeApproved[wallet] = false;
            for (uint256 i = 0; i < expected.length; i++) {
                if (expected[i] == wallet) {
                    expected[i] = expected[expected.length - 1];
                    expected.pop();
                    break;
                }
            }
        }
    }

    function mint(uint256 seed, uint96 amount) external {
        (address wallet,) = pick(seed);
        token.mint(wallet, amount);
    }

    function expectedCount() external view returns (uint256) {
        return expected.length;
    }

    function expectedBalance() external view returns (uint256 total) {
        for (uint256 i = 0; i < expected.length; i++) {
            total += token.balanceOf(expected[i]);
        }
    }
}

contract ReserveRegistryInvariantTest is Test {
    InvariantRegistry registry;
    MockToken token;
    ReserveHandler handler;

    address company = makeAddr("company");
    address auditor = makeAddr("auditor");

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new InvariantRegistry(company, auditor);
        token = new MockToken();
        handler = new ReserveHandler(registry, token, company, auditor);
        targetContract(address(handler));
    }

    function invariant_BalanceSumsExactlyTheApprovedSet() public view {
        assertEq(registry.reserveBalance(address(token)), handler.expectedBalance());
    }

    function invariant_ListMatchesTheApprovedSet() public view {
        assertEq(registry.reserveCount(), handler.expectedCount());
        for (uint256 i = 0; i < registry.reserveCount(); i++) {
            assertTrue(handler.shouldBeApproved(registry.reserves(i)));
        }
    }

    function invariant_NoWalletIsListedTwice() public view {
        uint256 n = registry.reserveCount();
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                assertTrue(registry.reserves(i) != registry.reserves(j));
            }
        }
    }

    function invariant_EveryListedWalletIsApproved() public view {
        for (uint256 i = 0; i < registry.reserveCount(); i++) {
            assertEq(
                uint256(registry.reserveStatus(registry.reserves(i))), uint256(ReserveRegistry.ReserveStatus.Approved)
            );
        }
    }

    function invariant_CountStaysWithinTheCap() public view {
        assertLe(registry.reserveCount(), registry.MAX_RESERVES());
    }

    function invariant_RolesStayDistinct() public view {
        assertTrue(registry.company() != registry.auditor());
    }
}
