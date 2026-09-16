// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReserveRegistry} from "../contracts/ReserveRegistry.sol";

contract Registry is ReserveRegistry {
    constructor(address company, address auditor) ReserveRegistry("Registry", company, auditor) {}
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract MockMultisig {
    bytes public approvedSignature;

    function approve(bytes calldata signature) external {
        approvedSignature = signature;
    }

    function isValidSignature(bytes32, bytes calldata signature) external view returns (bytes4) {
        return keccak256(signature) == keccak256(approvedSignature) ? this.isValidSignature.selector : bytes4(0);
    }
}

contract ReserveRegistryTest is Test {
    Registry registry;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address wallet;
    uint256 key;

    function setUp() public {
        vm.warp(1_700_000_000);
        (wallet, key) = makeAddrAndKey("reserve");
        registry = new Registry(company, auditor);
    }

    function sign(address signer, uint256 signerKey, uint256 expiry) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, registry.reserveDigest(signer, expiry));
        return abi.encodePacked(r, s, v);
    }

    function propose(address target) internal {
        vm.prank(company);
        registry.proposeReserve(target);
    }

    function status(address target) internal view returns (uint256) {
        return uint256(registry.reserveStatus(target));
    }

    function approve(address target, uint256 targetKey) internal {
        propose(target);
        registry.proveReserve(target, block.timestamp, sign(target, targetKey, block.timestamp));
        vm.prank(auditor);
        registry.reviewReserve(target, true);
    }

    // ---- roles --------------------------------------------------------------

    function test_RejectsMissingOrMergedRoles() public {
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(address(0), auditor);
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(company, address(0));
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(company, company);
    }

    function test_OnlyTheCompanyProposes() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.proposeReserve(wallet);
    }

    function test_OnlyTheAuditorApproves() public {
        propose(wallet);
        registry.proveReserve(wallet, block.timestamp, sign(wallet, key, block.timestamp));

        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.reviewReserve(wallet, true);
    }

    function test_OutsidersCannotRemove() public {
        propose(wallet);
        vm.prank(makeAddr("outsider"));
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.removeReserve(wallet);
    }

    // ---- lifecycle ----------------------------------------------------------

    function test_Lifecycle() public {
        propose(wallet);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Proposed));

        registry.proveReserve(wallet, block.timestamp, sign(wallet, key, block.timestamp));
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Proven));
        assertEq(registry.reserveCount(), 0);

        vm.prank(auditor);
        registry.reviewReserve(wallet, true);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Approved));
        assertEq(registry.reserveCount(), 1);
        assertEq(registry.reserves(0), wallet);

        vm.prank(auditor);
        registry.removeReserve(wallet);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.None));
        assertEq(registry.reserveCount(), 0);
    }

    function test_RemovalKeepsTheOtherReserves() public {
        address[3] memory wallets;
        for (uint256 i = 0; i < 3; i++) {
            uint256 walletKey;
            (wallets[i], walletKey) = makeAddrAndKey(string.concat("reserve", vm.toString(i)));
            propose(wallets[i]);
            registry.proveReserve(wallets[i], block.timestamp, sign(wallets[i], walletKey, block.timestamp));
            vm.prank(auditor);
            registry.reviewReserve(wallets[i], true);
        }

        vm.prank(company);
        registry.removeReserve(wallets[0]);
        assertEq(registry.reserveCount(), 2);
        assertEq(registry.reserves(0), wallets[2]);
        assertEq(registry.reserves(1), wallets[1]);
    }

    function test_AuditorCannotApproveAnUnprovenReserve() public {
        propose(wallet);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.reviewReserve(wallet, true);
    }

    function test_RejectedReserveCanBeProposedAgain() public {
        propose(wallet);
        registry.proveReserve(wallet, block.timestamp, sign(wallet, key, block.timestamp));
        vm.prank(auditor);
        registry.reviewReserve(wallet, false);

        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.None));
        assertEq(registry.reserveCount(), 0);
        propose(wallet);
    }

    function test_RejectsZeroAndDuplicateReserves() public {
        propose(wallet);
        vm.startPrank(company);
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.proposeReserve(address(0));
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.proposeReserve(wallet);
        vm.stopPrank();
    }

    function test_SumsOnlyApprovedReserves() public {
        MockToken token = new MockToken();
        (address other, uint256 otherKey) = makeAddrAndKey("other");
        token.mint(wallet, 5);
        token.mint(other, 7);
        vm.deal(wallet, 1 ether);

        propose(wallet);
        registry.proveReserve(wallet, block.timestamp, sign(wallet, key, block.timestamp));
        propose(other);
        registry.proveReserve(other, block.timestamp, sign(other, otherKey, block.timestamp));
        vm.prank(auditor);
        registry.reviewReserve(wallet, true);

        assertEq(registry.reserveBalance(address(token)), 5);
        assertEq(registry.reserveBalance(address(0)), 1 ether);
    }

    // ---- the reserve cap ----------------------------------------------------

    function test_ApprovalStopsAtMaxReserves() public {
        uint256 cap = registry.MAX_RESERVES();
        for (uint256 i = 0; i < cap; i++) {
            (address w, uint256 k) = makeAddrAndKey(string.concat("capped", vm.toString(i)));
            approve(w, k);
        }
        assertEq(registry.reserveCount(), cap);

        (address extra, uint256 extraKey) = makeAddrAndKey("one too many");
        propose(extra);
        registry.proveReserve(extra, block.timestamp, sign(extra, extraKey, block.timestamp));
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.TooManyReserves.selector);
        registry.reviewReserve(extra, true);

        address dropped = registry.reserves(0); // read first: vm.prank applies to the next call
        vm.prank(company);
        registry.removeReserve(dropped);
        vm.prank(auditor);
        registry.reviewReserve(extra, true);
        assertEq(registry.reserveCount(), cap);
    }

    // ---- signatures ---------------------------------------------------------

    function test_RejectsASignatureFromAnotherKey() public {
        (, uint256 wrongKey) = makeAddrAndKey("attacker");
        propose(wallet);

        bytes memory signature = sign(wallet, wrongKey, block.timestamp);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, block.timestamp, signature);
    }

    function test_RejectsMalformedAndHighSSignatures() public {
        propose(wallet);

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, block.timestamp, hex"00");

        // (r, n - s, v') recovers the same key, but is a second encoding of one signature.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(wallet, block.timestamp));
        uint256 n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory twin = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, block.timestamp, twin);
    }

    function test_RejectsAnExpiredSignature() public {
        propose(wallet);

        bytes memory signature = sign(wallet, key, block.timestamp);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(ReserveRegistry.SignatureExpired.selector);
        registry.proveReserve(wallet, block.timestamp - 1, signature);
    }

    function test_SignatureIsBoundToChainAndRegistry() public {
        bytes memory signature = sign(wallet, key, block.timestamp);

        Registry other = new Registry(company, auditor);
        vm.prank(company);
        other.proposeReserve(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        other.proveReserve(wallet, block.timestamp, signature);

        propose(wallet);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, block.timestamp, signature);
    }

    function test_SignatureCannotBeReplayedAfterRemoval() public {
        uint256 expiry = block.timestamp + 1 days;
        bytes memory signature = sign(wallet, key, expiry);

        propose(wallet);
        registry.proveReserve(wallet, expiry, signature);
        vm.prank(company);
        registry.removeReserve(wallet);

        propose(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, expiry, signature);
    }

    function test_SignatureCollectedBeforeRemovalCannotBeUsedAfter() public {
        propose(wallet);
        uint256 expiry = block.timestamp + 1 days;
        bytes memory signature = sign(wallet, key, expiry);

        vm.prank(company);
        registry.removeReserve(wallet);
        propose(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, expiry, signature);
    }

    function test_ContractWalletProvesControlThroughERC1271() public {
        MockMultisig multisig = new MockMultisig();
        multisig.approve(hex"c0ffee");
        propose(address(multisig));

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(address(multisig), block.timestamp, hex"bad0");

        registry.proveReserve(address(multisig), block.timestamp, hex"c0ffee");
        assertEq(status(address(multisig)), uint256(ReserveRegistry.ReserveStatus.Proven));
    }
}
