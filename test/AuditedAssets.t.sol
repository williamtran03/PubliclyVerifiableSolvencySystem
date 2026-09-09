// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {AuditedAssets} from "../contracts/AuditedAssets.sol";

contract Wallet1271 {
    function isValidSignature(bytes32, bytes calldata signature) external pure returns (bytes4) {
        return signature.length == 1 ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract AuditedAssetsTest is Test {
    AuditedAssets r;
    address auditor = address(2);
    address reserve;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function setUp() public {
        reserve = vm.addr(123);
        r = new AuditedAssets(address(this), auditor);
        vm.warp(1000);
    }

    function add() internal returns (uint256) {
        return r.addAsset(NATIVE, reserve, address(this), true);
    }

    function sign(uint256 id, uint256 expiry, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 a, bytes32 b) = vm.sign(key, r.ownershipDigest(id, expiry));
        return abi.encodePacked(a, b, v);
    }

    function test_ProposalOwnershipEligibilityAndRemoval() public {
        uint256 id = add();
        assertEq(uint256(r.getAsset(id).status), 1);
        vm.prank(reserve);
        r.verifyAsset(id, 1001, "");
        assertTrue(r.getAsset(id).ownershipVerified);
        assertEq(uint256(r.getAsset(id).status), 1);
        vm.prank(auditor);
        r.approveAsset(id, true);
        r.removeAsset(id);
        assertEq(uint256(r.getAsset(id).status), 2);
        vm.prank(auditor);
        r.verifyRemoveAsset(id, false);
        r.removeAsset(id);
        vm.prank(auditor);
        r.verifyRemoveAsset(id, true);
        assertEq(uint256(r.getAsset(id).status), 4);
        assertEq(r.getAsset(id).reserve, reserve);
        assertEq(add(), 2);
    }

    function test_RejectDuplicateAndZero() public {
        add();
        vm.expectRevert();
        add();
        vm.expectRevert();
        r.addAsset(address(0), reserve, address(this), true);
        vm.expectRevert();
        r.addAsset(NATIVE, address(0), address(this), true);
        vm.expectRevert();
        r.addAsset(NATIVE, reserve, address(0), true);
    }

    function test_SignatureExpiryInvalidAndReplay() public {
        uint256 id = add();
        bytes memory sig = sign(id, 1100, 123);
        vm.expectRevert();
        r.verifyAsset(id, 999, sig);
        vm.expectRevert();
        r.verifyAsset(id, 1101, sig);
        vm.expectRevert();
        r.verifyAsset(id, 1100, hex"00");
        r.verifyAsset(id, 1100, sig);
        vm.expectRevert();
        r.verifyAsset(id, 1100, sig);
    }

    function test_SignatureBoundToChainContractAndAsset() public {
        uint256 id = add();
        bytes memory sig = sign(id, 1100, 123);
        vm.chainId(100);
        vm.expectRevert();
        r.verifyAsset(id, 1100, sig);
        AuditedAssets other = new AuditedAssets(address(this), auditor);
        other.addAsset(NATIVE, reserve, address(this), true);
        vm.expectRevert();
        other.verifyAsset(1, 1100, sig);
    }

    function test_ContractWallet() public {
        Wallet1271 wallet = new Wallet1271();
        uint256 id = r.addAsset(NATIVE, address(wallet), address(this), true);
        vm.expectRevert();
        r.verifyAsset(id, 1001, "");
        r.verifyAsset(id, 1001, hex"01");
        assertTrue(r.getAsset(id).ownershipVerified);
    }

    function test_RolesAndRejection() public {
        uint256 id = add();
        vm.expectRevert();
        r.approveAsset(id, true);
        vm.prank(auditor);
        vm.expectRevert();
        r.approveAsset(id, true);
        vm.prank(address(7));
        vm.expectRevert();
        r.addAsset(NATIVE, reserve, address(this), true);
        vm.prank(address(7));
        vm.expectRevert();
        r.removeAsset(id);
        vm.prank(address(7));
        vm.expectRevert();
        r.verifyRemoveAsset(id, true);
        vm.prank(auditor);
        r.approveAsset(id, false);
        assertEq(uint256(r.getAsset(id).status), 3);
        assertEq(add(), 2);
    }

    function testFuzz_Signatures(uint256 key, uint64 expiry) public {
        key = bound(key, 1, 1e30);
        reserve = vm.addr(key);
        uint256 id = add();
        expiry = uint64(bound(expiry, 1000, type(uint64).max));
        bytes memory sig = sign(id, expiry, key);
        r.verifyAsset(id, expiry, sig);
        assertEq(r.getAsset(id).nonce, 1);
    }

    function test_ProposalEvent() public {
        vm.expectEmit(true, false, false, true);
        emit AuditedAssets.AssetProposed(1, NATIVE, reserve, address(this));
        add();
    }
}
