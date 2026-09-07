// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SolvencyRegistry} from "./SolvencyRegistry.sol";

/// @notice The generated UltraHonk verifier's only entry point.
interface ISolvencyVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/**
 * @title ZkSolvencyRegistry
 * @notice A registry that will not record a root until the custodian proves the
 *         tree behind it is well-formed.
 *
 * The plain registry takes the custodian's word for two things an inclusion
 * proof can never expose: that no leaf carries a negative balance cancelling a
 * real one, and that no customer appears twice. Both are invisible to every
 * individual customer, and both let the published total come out smaller than
 * what is actually owed.
 *
 * Here the root arrives with a zero-knowledge proof that every leaf is a valid
 * 128-bit balance and every leaf id is distinct — proven over the whole tree,
 * revealing none of it. The public inputs are exactly the two numbers this
 * contract is about to store, so the proof cannot be one for a different tree.
 */
contract ZkSolvencyRegistry is SolvencyRegistry {
    error ProofRequired();
    error InvalidProof();

    ISolvencyVerifier public immutable verifier;

    constructor(ISolvencyVerifier verifier_) {
        verifier = verifier_;
    }

    /// @dev Disabled: on this deployment a root without a proof is not a root.
    function submitEpoch(uint256, uint256) external pure override {
        revert ProofRequired();
    }

    /**
     * @param rootHash Merkle-sum root, and the circuit's first public input.
     * @param totalLiabilities Total owed in wei, and the circuit's second.
     * @param proof UltraHonk proof from `bb prove --verifier_target evm`.
     */
    function submitEpoch(uint256 rootHash, uint256 totalLiabilities, bytes calldata proof)
        external
        onlyOwner
    {
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = bytes32(rootHash);
        publicInputs[1] = bytes32(totalLiabilities);

        // `verify` reverts rather than returning false on most malformed input,
        // so both outcomes have to be treated as failure.
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        _submitEpoch(rootHash, totalLiabilities);
    }
}
