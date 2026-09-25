// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";

contract KzgVerifierTest is Test {
    KzgVerifier.G1Point commitment;
    KzgVerifier.G1Point shifted;
    uint256 value;
    KzgVerifier.G1Point proof;
    KzgVerifier.G2Point g2;
    KzgVerifier.G2Point tauG2;
    KzgVerifier.G2Point boundG2;

    function setUp() public {
        string memory json = vm.readFile("arms/snarkless/fixtures/epoch.json");
        commitment = g1(json, ".balanceCommitment");
        shifted = g1(json, ".shiftedCommitment");
        value = vm.parseJsonUint(json, ".constantTerm");
        proof = g1(json, ".sumProof");
        g2 = g2At(json, ".g2");
        tauG2 = g2At(json, ".tauG2");
        boundG2 = g2At(json, ".boundG2");
    }

    function g1(string memory json, string memory key) internal pure returns (KzgVerifier.G1Point memory) {
        return KzgVerifier.G1Point(
            vm.parseJsonUint(json, string.concat(key, ".x")), vm.parseJsonUint(json, string.concat(key, ".y"))
        );
    }

    function g2At(string memory json, string memory key) internal pure returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(
            vm.parseJsonUint(json, string.concat(key, ".xImag")),
            vm.parseJsonUint(json, string.concat(key, ".xReal")),
            vm.parseJsonUint(json, string.concat(key, ".yImag")),
            vm.parseJsonUint(json, string.concat(key, ".yReal"))
        );
    }

    function test_VerifiesARealOpening() public view {
        assertTrue(KzgVerifier.verifyOpening(commitment, 0, value, proof, g2, tauG2));
    }

    function test_RejectsAWrongValue() public view {
        assertFalse(KzgVerifier.verifyOpening(commitment, 0, value + 1, proof, g2, tauG2));
    }

    function test_VerifiesTheDegreeBound() public view {
        assertTrue(KzgVerifier.verifyDegreeBound(commitment, shifted, g2, boundG2));
        assertFalse(KzgVerifier.verifyDegreeBound(commitment, commitment, g2, boundG2));
    }

    function test_RejectsAWrongPoint() public {
        KzgVerifier.G1Point memory tamperedProof = KzgVerifier.G1Point(proof.x, proof.y + 1);
        vm.expectRevert(KzgVerifier.PointNotOnCurve.selector);
        this.verifyExternally(commitment, 0, value, tamperedProof);
    }

    function test_RejectsAScalarOutsideTheField() public {
        vm.expectRevert(KzgVerifier.ScalarOutOfField.selector);
        this.verifyExternally(commitment, 0, KzgVerifier.FR, proof);
    }

    function verifyExternally(KzgVerifier.G1Point memory c, uint256 z, uint256 v, KzgVerifier.G1Point memory p)
        external
        view
        returns (bool)
    {
        return KzgVerifier.verifyOpening(c, z, v, p, g2, tauG2);
    }
}
