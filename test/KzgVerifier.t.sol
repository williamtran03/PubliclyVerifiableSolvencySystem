// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";

contract KzgVerifierTest is Test {
    KzgVerifier.G1Point commitment;
    uint256 z;
    uint256 value;
    KzgVerifier.G1Point proof;
    KzgVerifier.G2Point g2;
    KzgVerifier.G2Point tauG2;

    function setUp() public {
        string memory json = vm.readFile("fixtures/kzg-epoch.json");

        commitment = KzgVerifier.G1Point(
            vm.parseJsonUint(json, ".commitment.x"),
            vm.parseJsonUint(json, ".commitment.y")
        );
        z = vm.parseJsonUint(json, ".z");
        value = vm.parseJsonUint(json, ".value");
        proof = KzgVerifier.G1Point(vm.parseJsonUint(json, ".proof.x"), vm.parseJsonUint(json, ".proof.y"));
        g2 = KzgVerifier.G2Point(
            vm.parseJsonUint(json, ".g2.xImag"),
            vm.parseJsonUint(json, ".g2.xReal"),
            vm.parseJsonUint(json, ".g2.yImag"),
            vm.parseJsonUint(json, ".g2.yReal")
        );
        tauG2 = KzgVerifier.G2Point(
            vm.parseJsonUint(json, ".tauG2.xImag"),
            vm.parseJsonUint(json, ".tauG2.xReal"),
            vm.parseJsonUint(json, ".tauG2.yImag"),
            vm.parseJsonUint(json, ".tauG2.yReal")
        );
    }

    function test_VerifiesARealOpening() public view {
        assertTrue(KzgVerifier.verifyOpening(commitment, z, value, proof, g2, tauG2));
    }

    function test_RejectsAWrongValue() public view {
        assertFalse(KzgVerifier.verifyOpening(commitment, z, value + 1, proof, g2, tauG2));
    }

    function test_RejectsAWrongPoint() public {
        KzgVerifier.G1Point memory tamperedProof = KzgVerifier.G1Point(proof.x, proof.y + 1);
        vm.expectRevert(KzgVerifier.PointNotOnCurve.selector);
        this.verifyExternally(commitment, z, value, tamperedProof, g2, tauG2);
    }

    function verifyExternally(
        KzgVerifier.G1Point memory c,
        uint256 z_,
        uint256 v,
        KzgVerifier.G1Point memory p,
        KzgVerifier.G2Point memory g,
        KzgVerifier.G2Point memory tg
    ) external view returns (bool) {
        return KzgVerifier.verifyOpening(c, z_, v, p, g, tg);
    }
}
