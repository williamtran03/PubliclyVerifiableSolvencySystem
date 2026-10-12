// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgLiabilityArgument} from "../contracts/KzgLiabilityArgument.sol";

contract KzgVerifierTest is Test {
    KzgVerifier.G1Point commitment;
    uint256 z;
    uint256 value;
    KzgVerifier.G1Point proof;
    KzgVerifier.G2Point g2;
    KzgVerifier.G2Point tauG2;

    function setUp() public {
        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");
        string memory inclusion = vm.readFile("arms/snarkless/fixtures/inclusion.json");
        g2 = g2At(epoch, ".g2");
        tauG2 = g2At(epoch, ".tauG2");

        KzgVerifier.G1Point memory identityCommitment = g1(epoch, ".identityCommitment");
        KzgVerifier.G1Point memory balanceCommitment = g1(epoch, ".balanceCommitment");
        uint256 identity = vm.parseJsonUint(inclusion, "[0].identity");
        uint256 balance = vm.parseJsonUint(inclusion, "[0].balance");
        z = 1;

        bytes32 state = keccak256("solvency/inclusion/v1");
        state = KzgLiabilityArgument.absorbScalar(state, vm.parseJsonUint(epoch, ".context"));
        state = KzgLiabilityArgument.absorbPoint(state, identityCommitment);
        state = KzgLiabilityArgument.absorbPoint(state, balanceCommitment);
        state = KzgLiabilityArgument.absorbScalar(state, z);
        state = KzgLiabilityArgument.absorbScalar(state, identity);
        state = KzgLiabilityArgument.absorbScalar(state, balance);
        (, uint256 nu) = KzgLiabilityArgument.challenge(state);

        commitment = KzgVerifier.add(identityCommitment, KzgVerifier.mul(balanceCommitment, nu));
        value = addmod(identity, mulmod(nu, balance, KzgVerifier.FR), KzgVerifier.FR);
        proof = g1(inclusion, "[0].proof");
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
        assertTrue(KzgVerifier.verifyOpening(commitment, z, value, proof, g2, tauG2));
    }

    function test_RejectsAWrongValue() public view {
        assertFalse(KzgVerifier.verifyOpening(commitment, z, value + 1, proof, g2, tauG2));
    }

    function test_RejectsAWrongPoint() public {
        KzgVerifier.G1Point memory tamperedProof = KzgVerifier.G1Point(proof.x, proof.y + 1);
        vm.expectRevert(KzgVerifier.PointNotOnCurve.selector);
        this.verifyExternally(commitment, z, value, tamperedProof);
    }

    function test_RejectsAScalarOutsideTheField() public {
        vm.expectRevert(KzgVerifier.ScalarOutOfField.selector);
        this.verifyExternally(commitment, z, KzgVerifier.FR, proof);
    }

    function verifyExternally(KzgVerifier.G1Point memory c, uint256 at, uint256 v, KzgVerifier.G1Point memory p)
        external
        view
        returns (bool)
    {
        return KzgVerifier.verifyOpening(c, at, v, p, g2, tauG2);
    }
}
