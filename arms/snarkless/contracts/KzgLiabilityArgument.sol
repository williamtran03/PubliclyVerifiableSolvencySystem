// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KzgVerifier} from "./KzgVerifier.sol";

library KzgLiabilityArgument {
    uint256 internal constant DOMAIN_SIZE = 8;
    uint256 internal constant BALANCE_BITS = 64;
    uint256 internal constant VALUE_COUNT = BALANCE_BITS + 3;
    uint256 internal constant OMEGA = 19540430494807482326159819597004422086093766032135589407132600596362845576832;
    uint256 private constant LAST_ROOT = 8613538655231327379234925296132678673308827349856085326283699237864372525723;
    uint256 private constant FR = KzgVerifier.FR;
    uint256 private constant G2_X_IMAG = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 private constant G2_X_REAL = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 private constant G2_Y_IMAG = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 private constant G2_Y_REAL = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 private constant TAU_G2_X_IMAG =
        10764647077472957448033591885865458661573660819003350325268673957890498500987;
    uint256 private constant TAU_G2_X_REAL =
        18253511544609001572866960948873128266198935669250718031100637619547827597184;
    uint256 private constant TAU_G2_Y_IMAG =
        15207030507740967976352749097256929091435606784526748170016829002013506957017;
    uint256 private constant TAU_G2_Y_REAL =
        19756181390911900613508142947142748782977087973617411469215564659012323409872;

    struct Proof {
        KzgVerifier.G1Point[] bitCommitments;
        KzgVerifier.G1Point accumulatorCommitment;
        KzgVerifier.G1Point quotientCommitment;
        uint256[] values;
        uint256 shiftedAccumulator;
        KzgVerifier.G1Point proofAtZeta;
        KzgVerifier.G1Point proofAtShiftedZeta;
    }

    struct Challenges {
        uint256 gamma;
        uint256 zeta;
        uint256 nu;
        uint256 r;
        bytes32 state;
    }

    struct Point {
        uint256 vanishing;
        uint256 fromFirst;
        uint256 fromLast;
        uint256 denominator;
    }

    struct PairingInput {
        KzgVerifier.G1Point withG2;
        KzgVerifier.G1Point withTau;
    }

    function g2() internal pure returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(G2_X_IMAG, G2_X_REAL, G2_Y_IMAG, G2_Y_REAL);
    }

    function tauG2() internal pure returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(TAU_G2_X_IMAG, TAU_G2_X_REAL, TAU_G2_Y_IMAG, TAU_G2_Y_REAL);
    }

    function verify(KzgVerifier.G1Point memory balanceCommitment, uint256 total, Proof calldata proof, uint256 context)
        internal
        view
        returns (bool)
    {
        (bool ok, PairingInput memory input,) = prepare(balanceCommitment, total, proof, context);
        return ok && KzgVerifier.pairingProductIsOne(input.withG2, g2(), KzgVerifier.negate(input.withTau), tauG2());
    }

    function prepare(KzgVerifier.G1Point memory balanceCommitment, uint256 total, Proof calldata proof, uint256 context)
        internal
        view
        returns (bool ok, PairingInput memory input, bytes32 state)
    {
        if (!wellFormed(total, proof)) return (false, input, state);
        Challenges memory c = challenges(balanceCommitment, total, proof, context);
        Point memory p = pointAt(c.zeta);
        if (c.zeta == 0 || p.vanishing == 0 || !identityHolds(proof, total, c.gamma, p)) {
            return (false, input, c.state);
        }
        input = pairingInput(balanceCommitment, proof, c);
        return (true, input, c.state);
    }

    function wellFormed(uint256 total, Proof calldata proof) private pure returns (bool) {
        if (total >= FR || proof.shiftedAccumulator >= FR) return false;
        if (proof.bitCommitments.length != BALANCE_BITS || proof.values.length != VALUE_COUNT) return false;
        for (uint256 i = 0; i < VALUE_COUNT; i++) {
            if (proof.values[i] >= FR) return false;
        }
        return true;
    }

    function challenges(
        KzgVerifier.G1Point memory balanceCommitment,
        uint256 total,
        Proof calldata proof,
        uint256 context
    ) private pure returns (Challenges memory c) {
        bytes32 state = keccak256("solvency/liabilities/v1");
        state = absorbScalar(state, context);
        state = absorbScalar(state, total);
        state = absorbPoint(state, balanceCommitment);
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            state = absorbPoint(state, proof.bitCommitments[k]);
        }
        state = absorbPoint(state, proof.accumulatorCommitment);
        (state, c.gamma) = challenge(state);
        state = absorbPoint(state, proof.quotientCommitment);
        (state, c.zeta) = challenge(state);
        for (uint256 i = 0; i < VALUE_COUNT; i++) {
            state = absorbScalar(state, proof.values[i]);
        }
        state = absorbScalar(state, proof.shiftedAccumulator);
        (state, c.nu) = challenge(state);
        state = absorbPoint(state, proof.proofAtZeta);
        state = absorbPoint(state, proof.proofAtShiftedZeta);
        (state, c.r) = challenge(state);
        c.state = state;
    }

    function identityHolds(Proof calldata proof, uint256 total, uint256 gamma, Point memory p)
        private
        pure
        returns (bool)
    {
        (uint256 left, uint256 gammaPower) = bitTerms(proof.values, gamma);
        uint256 accumulatorAt = proof.values[BALANCE_BITS + 1];
        uint256 sum = addmod(accumulatorAt, proof.values[0], FR);
        gammaPower = mulmod(gammaPower, gamma, FR);
        uint256 start = mulmod(gammaPower, mulmod(mulmod(p.vanishing, p.fromLast, FR), accumulatorAt, FR), FR);
        gammaPower = mulmod(gammaPower, gamma, FR);
        uint256 step = mulmod(p.fromLast, addmod(proof.shiftedAccumulator, FR - sum, FR), FR);
        left = mulmod(addmod(left, mulmod(gammaPower, step, FR), FR), p.denominator, FR);
        gammaPower = mulmod(gammaPower, gamma, FR);
        uint256 finish = mulmod(LAST_ROOT, mulmod(p.vanishing, p.fromFirst, FR), FR);
        finish = mulmod(gammaPower, mulmod(finish, addmod(sum, FR - total, FR), FR), FR);
        left = addmod(addmod(left, start, FR), finish, FR);
        return left == mulmod(p.denominator, mulmod(p.vanishing, proof.values[BALANCE_BITS + 2], FR), FR);
    }

    function pointAt(uint256 zeta) private pure returns (Point memory p) {
        uint256 squared = mulmod(zeta, zeta, FR);
        squared = mulmod(squared, squared, FR);
        p.vanishing = addmod(mulmod(squared, squared, FR), FR - 1, FR);
        p.fromFirst = addmod(zeta, FR - 1, FR);
        p.fromLast = addmod(zeta, FR - LAST_ROOT, FR);
        p.denominator = mulmod(DOMAIN_SIZE, mulmod(p.fromFirst, p.fromLast, FR), FR);
    }

    function bitTerms(uint256[] calldata values, uint256 gamma)
        private
        pure
        returns (uint256 left, uint256 gammaPower)
    {
        gammaPower = 1;
        uint256 reconstructed;
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            uint256 bit = values[1 + k];
            left = addmod(left, mulmod(gammaPower, addmod(mulmod(bit, bit, FR), FR - bit, FR), FR), FR);
            reconstructed = addmod(reconstructed, mulmod(1 << k, bit, FR), FR);
            gammaPower = mulmod(gammaPower, gamma, FR);
        }
        left = addmod(left, mulmod(gammaPower, addmod(reconstructed, FR - values[0], FR), FR), FR);
    }

    function pairingInput(KzgVerifier.G1Point memory balanceCommitment, Proof calldata proof, Challenges memory c)
        private
        view
        returns (PairingInput memory input)
    {
        KzgVerifier.G1Point memory folded = balanceCommitment;
        uint256 foldedValue = proof.values[0];
        uint256 nuPower = 1;
        for (uint256 k = 0; k < VALUE_COUNT - 1; k++) {
            nuPower = mulmod(nuPower, c.nu, FR);
            KzgVerifier.G1Point memory commitment = k < BALANCE_BITS
                ? proof.bitCommitments[k]
                : (k == BALANCE_BITS ? proof.accumulatorCommitment : proof.quotientCommitment);
            folded = KzgVerifier.add(folded, KzgVerifier.mul(commitment, nuPower));
            foldedValue = addmod(foldedValue, mulmod(proof.values[1 + k], nuPower, FR), FR);
        }

        uint256 shiftedZeta = mulmod(c.zeta, OMEGA, FR);
        folded = KzgVerifier.add(folded, KzgVerifier.mul(proof.proofAtZeta, c.zeta));
        KzgVerifier.G1Point memory shifted =
            KzgVerifier.add(proof.accumulatorCommitment, KzgVerifier.mul(proof.proofAtShiftedZeta, shiftedZeta));
        uint256 generatorScalar = addmod(foldedValue, mulmod(c.r, proof.shiftedAccumulator, FR), FR);

        input.withG2 = KzgVerifier.sub(
            KzgVerifier.add(folded, KzgVerifier.mul(shifted, c.r)),
            KzgVerifier.mul(KzgVerifier.generator(), generatorScalar)
        );
        input.withTau = KzgVerifier.add(proof.proofAtZeta, KzgVerifier.mul(proof.proofAtShiftedZeta, c.r));
    }

    function absorbPoint(bytes32 state, KzgVerifier.G1Point memory point) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, point.x, point.y));
    }

    function absorbScalar(bytes32 state, uint256 value) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, value % FR));
    }

    function challenge(bytes32 state) internal pure returns (bytes32 next, uint256 value) {
        next = keccak256(abi.encodePacked(state, bytes1(0x01)));
        value = uint256(next) % FR;
    }
}
