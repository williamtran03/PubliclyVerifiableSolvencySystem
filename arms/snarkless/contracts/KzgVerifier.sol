// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library KzgVerifier {
    uint256 internal constant FP = // base field
        21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 internal constant FR = // scalar field
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    error EcAddFailed();
    error EcMulFailed();
    error PairingFailed();
    error PointNotOnCurve();

    struct G1Point {
        uint256 x;
        uint256 y;
    }

    struct G2Point {
        // precompile order: imaginary part first
        uint256 xImag;
        uint256 xReal;
        uint256 yImag;
        uint256 yReal;
    }

    function verifyOpening(
        G1Point memory commitment,
        uint256 z,
        uint256 value,
        G1Point memory proof,
        G2Point memory g2,
        G2Point memory tauG2
    ) internal view returns (bool) {
        requireOnCurve(commitment);
        requireOnCurve(proof);
        if (z >= FR || value >= FR) revert PointNotOnCurve();

        G1Point memory lhs = add(sub(commitment, mul(generator(), value)), mul(proof, z));
        return pairingProductIsOne(lhs, g2, negate(proof), tauG2);
    }

    function generator() internal pure returns (G1Point memory) {
        return G1Point(1, 2);
    }

    function isZero(G1Point memory point) internal pure returns (bool) {
        return point.x == 0 && point.y == 0;
    }

    function requireOnCurve(G1Point memory point) internal pure {
        if (isZero(point)) return;
        if (point.x >= FP || point.y >= FP) revert PointNotOnCurve();
        if (mulmod(point.y, point.y, FP) != addmod(mulmod(point.x, mulmod(point.x, point.x, FP), FP), 3, FP)) {
            revert PointNotOnCurve();
        }
    }

    function negate(G1Point memory point) internal pure returns (G1Point memory) {
        if (isZero(point)) return point;
        return G1Point(point.x, FP - (point.y % FP));
    }

    function add(G1Point memory a, G1Point memory b) internal view returns (G1Point memory result) {
        if (isZero(a)) return b;
        if (isZero(b)) return a;

        uint256[4] memory input = [a.x, a.y, b.x, b.y];
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 0x06, input, 0x80, result, 0x40)
        }
        if (!success) revert EcAddFailed();
    }

    function sub(G1Point memory a, G1Point memory b) internal view returns (G1Point memory) {
        return add(a, negate(b));
    }

    function mul(G1Point memory point, uint256 scalar) internal view returns (G1Point memory result) {
        uint256 s = scalar % FR;
        if (s == 0 || isZero(point)) return G1Point(0, 0);

        uint256[3] memory input = [point.x, point.y, s];
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 0x07, input, 0x60, result, 0x40)
        }
        if (!success) revert EcMulFailed();
    }

    function pairingProductIsOne(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2
    ) internal view returns (bool) {
        uint256[12] memory input = [
            a1.x, a1.y, a2.xImag, a2.xReal, a2.yImag, a2.yReal,
            b1.x, b1.y, b2.xImag, b2.xReal, b2.yImag, b2.yReal
        ];

        uint256[1] memory out;
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 0x08, input, 0x180, out, 0x20)
        }
        if (!success) revert PairingFailed();
        return out[0] == 1;
    }
}
