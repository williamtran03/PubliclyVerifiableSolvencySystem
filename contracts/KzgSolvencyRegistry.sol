// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KzgVerifier} from "./KzgVerifier.sol";
import {SolvencyRegistry} from "./SolvencyRegistry.sol";

/**
 * @title KzgSolvencyRegistry
 * @notice Liabilities as a polynomial commitment, and the total as a single
 *         opening of it — the "grand sum" construction from Summa V2, with no
 *         SNARK anywhere in the verification path.
 *
 * Balances are interpolated so that `p(omega^i)` is customer i's balance. The
 * sum of a polynomial's evaluations over all n-th roots of unity is `n * p(0)`,
 * because every non-constant term cancels around the circle. So the custodian
 * proves its total by opening the commitment at zero, and this contract checks
 * one pairing equation.
 *
 * What that leaves out is range: in a prime field "minus ten" is an enormous
 * positive number, and one of those parked in an unused slot would cancel a
 * real customer and shrink the total. The proof of *that* is a separate
 * polynomial argument (`prover/kzg/range.ts`) whose artifact is committed to
 * here by hash and verified off-chain, because it opens 130 polynomials and
 * folding them on-chain would cost more than the SNARK this branch exists to
 * avoid. `docs/comparison.md` is explicit about that trade.
 */
contract KzgSolvencyRegistry is SolvencyRegistry {
    using KzgVerifier for KzgVerifier.G1Point;

    struct Commitment {
        uint256 balanceX;
        uint256 balanceY;
        uint256 idX;
        uint256 idY;
        bytes32 rangeProofHash;
    }

    error ProofRequired();
    error InvalidGrandSumProof();
    error TotalOutOfField(uint256 total);
    error IndexOutOfRange(uint256 index, uint256 domainSize);

    event CommitmentPublished(
        uint256 indexed epochId,
        uint256 balanceX,
        uint256 balanceY,
        uint256 idX,
        uint256 idY,
        bytes32 rangeProofHash
    );

    /// Number of leaves the polynomials are interpolated over, a power of two.
    uint256 public immutable domainSize;
    /// A primitive `domainSize`-th root of unity in the scalar field.
    uint256 public immutable omega;
    /// `domainSize^-1 mod FR`, so the total can be turned into `p(0)`.
    uint256 public immutable domainSizeInverse;

    // The SRS's G2 elements. Solidity has no immutable structs, hence eight of
    // these; they are the only part of the trusted setup this contract needs.
    uint256 private immutable g2xImag;
    uint256 private immutable g2xReal;
    uint256 private immutable g2yImag;
    uint256 private immutable g2yReal;
    uint256 private immutable tauG2xImag;
    uint256 private immutable tauG2xReal;
    uint256 private immutable tauG2yImag;
    uint256 private immutable tauG2yReal;

    Commitment public currentCommitment;

    constructor(
        uint256 domainSize_,
        uint256 omega_,
        uint256 domainSizeInverse_,
        uint256[4] memory g2_,
        uint256[4] memory tauG2_
    ) {
        domainSize = domainSize_;
        omega = omega_;
        domainSizeInverse = domainSizeInverse_;
        (g2xImag, g2xReal, g2yImag, g2yReal) = (g2_[0], g2_[1], g2_[2], g2_[3]);
        (tauG2xImag, tauG2xReal, tauG2yImag, tauG2yReal) =
            (tauG2_[0], tauG2_[1], tauG2_[2], tauG2_[3]);
    }

    /// @dev Disabled: on this deployment a total without an opening is not a total.
    function submitEpoch(uint256, uint256) external pure override {
        revert ProofRequired();
    }

    /**
     * @notice Publishes an epoch: the commitments, the total, and the opening
     *         at zero that ties them together.
     * @param balanceCommitment `[p(tau)]_1` for the balance polynomial.
     * @param idCommitment `[u(tau)]_1` for the customer-id polynomial.
     * @param totalLiabilities Total owed in wei.
     * @param grandSumProof Opening proof of `balanceCommitment` at zero.
     * @param rangeProofHash keccak256 of the published range-argument artifact.
     */
    function submitEpoch(
        uint256[2] calldata balanceCommitment,
        uint256[2] calldata idCommitment,
        uint256 totalLiabilities,
        uint256[2] calldata grandSumProof,
        bytes32 rangeProofHash
    ) external onlyOwner {
        // Without this a custodian could publish a total that wraps the field
        // and open the commitment at the wrapped value instead.
        if (totalLiabilities >= KzgVerifier.FR) revert TotalOutOfField(totalLiabilities);

        uint256 constantCoefficient =
            mulmod(totalLiabilities, domainSizeInverse, KzgVerifier.FR);

        bool valid = KzgVerifier.verifyOpening(
            KzgVerifier.G1Point(balanceCommitment[0], balanceCommitment[1]),
            0,
            constantCoefficient,
            KzgVerifier.G1Point(grandSumProof[0], grandSumProof[1]),
            _g2(),
            _tauG2()
        );
        if (!valid) revert InvalidGrandSumProof();

        currentCommitment = Commitment({
            balanceX: balanceCommitment[0],
            balanceY: balanceCommitment[1],
            idX: idCommitment[0],
            idY: idCommitment[1],
            rangeProofHash: rangeProofHash
        });

        emit CommitmentPublished(
            epochCount,
            balanceCommitment[0],
            balanceCommitment[1],
            idCommitment[0],
            idCommitment[1],
            rangeProofHash
        );

        // The base registry's notion of "the root" is the hash of everything
        // published, so its events and insolvency check work unchanged.
        _submitEpoch(
            uint256(keccak256(abi.encode(balanceCommitment, idCommitment, rangeProofHash))),
            totalLiabilities
        );
    }

    /**
     * @notice The challenge that folds the two commitments into one opening.
     * @dev Mirrored exactly by `inclusionChallenge` in
     *      `prover/kzg/grandSum.ts`, so neither side has to be told the value.
     */
    function inclusionChallenge(uint256 index, uint256 id, uint256 balance)
        public
        view
        returns (uint256)
    {
        Commitment memory c = currentCommitment;
        return uint256(
            keccak256(abi.encode(c.balanceX, c.balanceY, c.idX, c.idY, index, id, balance))
        ) % KzgVerifier.FR;
    }

    /**
     * @notice Checks one customer's balance against the published commitment.
     * @dev Read-only and callable by anyone: a customer needs no wallet, no gas
     *      and no account to check that the total they are counted in includes
     *      the balance they think they have.
     */
    function verifyInclusion(uint256 index, uint256 id, uint256 balance, uint256[2] calldata proof)
        external
        view
        returns (bool)
    {
        if (index >= domainSize) revert IndexOutOfRange(index, domainSize);

        Commitment memory c = currentCommitment;
        uint256 nu = inclusionChallenge(index, id, balance);

        KzgVerifier.G1Point memory folded = KzgVerifier.add(
            KzgVerifier.G1Point(c.balanceX, c.balanceY),
            KzgVerifier.mul(KzgVerifier.G1Point(c.idX, c.idY), nu)
        );
        uint256 value = addmod(balance, mulmod(nu, id, KzgVerifier.FR), KzgVerifier.FR);

        return KzgVerifier.verifyOpening(
            folded,
            KzgVerifier.expModFr(omega, index),
            value,
            KzgVerifier.G1Point(proof[0], proof[1]),
            _g2(),
            _tauG2()
        );
    }

    function _g2() private view returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(g2xImag, g2xReal, g2yImag, g2yReal);
    }

    function _tauG2() private view returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(tauG2xImag, tauG2xReal, tauG2yImag, tauG2yReal);
    }
}
