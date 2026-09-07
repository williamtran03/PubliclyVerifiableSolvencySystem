/**
 * Constants shared between the TypeScript prover and the Noir circuit.
 *
 * A circuit is fixed-size: the number of leaves is baked into the verification
 * key, so the two sides have to agree or the proof simply will not verify. This
 * file exists so that disagreement is an error message rather than a mystery.
 * Changing it means changing `LEAVES` in `circuits/solvency/src/main.nr` too,
 * and republishing the verifier.
 */
export const LEAVES = 8;
