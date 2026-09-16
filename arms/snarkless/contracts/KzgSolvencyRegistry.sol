// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KzgVerifier} from "./KzgVerifier.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";

contract KzgSolvencyRegistry is ReserveRegistry {
    uint256 public constant DOMAIN_SIZE = 8;
    uint256 public constant BALANCE_BITS = 64;
    uint256 private constant FR = KzgVerifier.FR;
    uint256 private constant DOMAIN_SIZE_INVERSE =
        19152212512859365819465605027100115702479818850364030050735928663253832433665;
    uint256 private constant OMEGA = 19540430494807482326159819597004422086093766032135589407132600596362845576832;

    struct Srs {
        KzgVerifier.G2Point g2;
        KzgVerifier.G2Point tauG2;
        KzgVerifier.G2Point boundG2;
    }

    struct GrandSum {
        KzgVerifier.G1Point balanceCommitment;
        KzgVerifier.G1Point shiftedCommitment;
        KzgVerifier.G1Point identityCommitment;
        uint256 totalLiabilities;
        KzgVerifier.G1Point sumProof;
    }

    struct RangeProof {
        KzgVerifier.G1Point[] bitCommitments;
        KzgVerifier.G1Point quotientCommitment;
        uint256[] values;
        KzgVerifier.G1Point batchProof;
    }

    struct Epoch {
        KzgVerifier.G1Point balanceCommitment;
        KzgVerifier.G1Point identityCommitment;
        uint256 totalLiabilities;
        uint256 reserveUnits;
        uint64 timestamp;
    }

    address public immutable token;
    uint8 public immutable decimals;
    Srs private srs;
    mapping(uint256 => Epoch) private epochs;
    uint256 public epochCount;

    event EpochSubmitted(uint256 indexed epochId, uint256 totalLiabilities, uint256 reserveUnits);

    error Insolvent(uint256 reserveUnits, uint256 totalLiabilities);
    error DegreeTooHigh();
    error InvalidOpening();
    error InvalidRangeProof();
    error NoEpoch();

    constructor(
        address _company,
        address _auditor,
        address _token,
        uint8 _decimals,
        Srs memory _srs,
        uint64 _maxEpochAge
    ) ReserveRegistry("KzgSolvencyRegistry", _company, _auditor, _maxEpochAge) {
        token = _token;
        decimals = _decimals;
        srs = _srs;
    }

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        if (epochId >= epochCount) revert NoEpoch();
        return epochs[epochId];
    }

    function epochContext(uint256 epochId) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), epochId))) % FR;
    }

    function reserveUnits() public view returns (uint256) {
        return reserveBalance(token) / (10 ** decimals);
    }

    function submitEpoch(GrandSum calldata sum, RangeProof calldata range) external onlyCompany {
        uint256 units = reserveUnits();
        if (units < sum.totalLiabilities) revert Insolvent(units, sum.totalLiabilities);

        if (!KzgVerifier.verifyDegreeBound(sum.balanceCommitment, sum.shiftedCommitment, srs.g2, srs.boundG2)) {
            revert DegreeTooHigh();
        }
        if (sum.totalLiabilities >= FR) revert InvalidOpening();
        uint256 constantTerm = mulmod(sum.totalLiabilities, DOMAIN_SIZE_INVERSE, FR);
        if (!KzgVerifier.verifyOpening(sum.balanceCommitment, 0, constantTerm, sum.sumProof, srs.g2, srs.tauG2)) {
            revert InvalidOpening();
        }
        if (!verifyRange(sum.balanceCommitment, range, epochContext(epochCount))) revert InvalidRangeProof();

        _recordEpoch();
        epochs[epochCount] =
            Epoch(sum.balanceCommitment, sum.identityCommitment, sum.totalLiabilities, units, uint64(block.timestamp));
        emit EpochSubmitted(epochCount, sum.totalLiabilities, units);
        epochCount++;
    }

    function verifyInclusion(
        uint256 epochId,
        uint256 index,
        uint256 identity,
        uint256 balance,
        KzgVerifier.G1Point calldata proof
    ) external view returns (bool) {
        if (epochId >= epochCount || index >= DOMAIN_SIZE || identity >= FR || balance >= FR) {
            return false;
        }
        Epoch storage epoch = epochs[epochId];

        uint256 z = 1;
        for (uint256 i = 0; i < index; i++) {
            z = mulmod(z, OMEGA, FR);
        }

        bytes32 state = keccak256("solvency/inclusion/v1");
        state = absorbScalar(state, epochContext(epochId));
        state = absorbPoint(state, epoch.identityCommitment);
        state = absorbPoint(state, epoch.balanceCommitment);
        state = absorbScalar(state, z);
        state = absorbScalar(state, identity);
        state = absorbScalar(state, balance);
        (, uint256 nu) = challenge(state);

        KzgVerifier.G1Point memory folded =
            KzgVerifier.add(epoch.identityCommitment, KzgVerifier.mul(epoch.balanceCommitment, nu));
        uint256 value = addmod(identity, mulmod(nu, balance, FR), FR);
        return KzgVerifier.verifyOpening(folded, z, value, proof, srs.g2, srs.tauG2);
    }

    function verifyRange(KzgVerifier.G1Point memory balanceCommitment, RangeProof calldata proof, uint256 context)
        private
        view
        returns (bool)
    {
        if (proof.bitCommitments.length != BALANCE_BITS || proof.values.length != BALANCE_BITS + 2) return false;
        for (uint256 i = 0; i < proof.values.length; i++) {
            if (proof.values[i] >= FR) return false;
        }

        (uint256 gamma, uint256 zeta, uint256 nu) = rangeChallenges(balanceCommitment, proof, context);
        uint256 vanishing = addmod(power(zeta, DOMAIN_SIZE), FR - 1, FR);
        if (zeta == 0 || vanishing == 0) return false;
        if (!rangeIdentityHolds(proof.values, gamma, vanishing)) return false;

        (KzgVerifier.G1Point memory folded, uint256 foldedValue) = foldRange(balanceCommitment, proof, nu);
        return KzgVerifier.verifyOpening(folded, zeta, foldedValue, proof.batchProof, srs.g2, srs.tauG2);
    }

    function rangeChallenges(KzgVerifier.G1Point memory balanceCommitment, RangeProof calldata proof, uint256 context)
        private
        pure
        returns (uint256 gamma, uint256 zeta, uint256 nu)
    {
        bytes32 state = keccak256("solvency/range/v1");
        state = absorbScalar(state, context);
        state = absorbPoint(state, balanceCommitment);
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            state = absorbPoint(state, proof.bitCommitments[k]);
        }
        (state, gamma) = challenge(state);
        state = absorbPoint(state, proof.quotientCommitment);
        (state, zeta) = challenge(state);
        for (uint256 i = 0; i < proof.values.length; i++) {
            state = absorbScalar(state, proof.values[i]);
        }
        (, nu) = challenge(state);
    }

    function rangeIdentityHolds(uint256[] calldata values, uint256 gamma, uint256 vanishing)
        private
        pure
        returns (bool)
    {
        uint256 left;
        uint256 gammaPower = 1;
        uint256 reconstructed;
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            uint256 bit = values[1 + k];
            left = addmod(left, mulmod(gammaPower, addmod(mulmod(bit, bit, FR), FR - bit, FR), FR), FR);
            reconstructed = addmod(reconstructed, mulmod(1 << k, bit, FR), FR);
            gammaPower = mulmod(gammaPower, gamma, FR);
        }
        left = addmod(left, mulmod(gammaPower, addmod(reconstructed, FR - values[0], FR), FR), FR);
        return left == mulmod(vanishing, values[BALANCE_BITS + 1], FR);
    }

    function foldRange(KzgVerifier.G1Point memory balanceCommitment, RangeProof calldata proof, uint256 nu)
        private
        view
        returns (KzgVerifier.G1Point memory folded, uint256 foldedValue)
    {
        folded = balanceCommitment;
        foldedValue = proof.values[0];
        uint256 nuPower = 1;
        for (uint256 k = 0; k <= BALANCE_BITS; k++) {
            nuPower = mulmod(nuPower, nu, FR);
            KzgVerifier.G1Point memory commitment =
                k < BALANCE_BITS ? proof.bitCommitments[k] : proof.quotientCommitment;
            KzgVerifier.requireOnCurve(commitment);
            folded = KzgVerifier.add(folded, KzgVerifier.mul(commitment, nuPower));
            foldedValue = addmod(foldedValue, mulmod(proof.values[1 + k], nuPower, FR), FR);
        }
    }

    function absorbPoint(bytes32 state, KzgVerifier.G1Point memory point) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, point.x, point.y));
    }

    function absorbScalar(bytes32 state, uint256 value) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, value % FR));
    }

    function challenge(bytes32 state) private pure returns (bytes32 next, uint256 value) {
        next = keccak256(abi.encodePacked(state, bytes1(0x01)));
        value = uint256(next) % FR;
    }

    function power(uint256 base, uint256 exponent) private pure returns (uint256 result) {
        result = 1;
        for (uint256 i = 0; i < exponent; i++) {
            result = mulmod(result, base, FR);
        }
    }
}
