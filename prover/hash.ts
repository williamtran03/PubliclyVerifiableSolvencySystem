import { encodePacked, keccak256, toBytes } from "viem";
import { poseidon2, poseidon4 } from "poseidon-lite";
import { BN254_FR, mod } from "./field.ts";

/**
 * A hash function over field elements. Only arities 2 (leaves) and 4 (nodes)
 * are ever used, so implementations may reject anything else.
 */
export type HashFn = (values: bigint[]) => bigint;

/**
 * Poseidon over BN254, circomlib parameters.
 *
 * This is the project default. It is bit-for-bit the same permutation as
 * `poseidon::poseidon::bn254::{hash_2, hash_4}` in the Noir circuit, which is
 * what lets the TypeScript prover and the circuit agree on a root without
 * either side re-implementing the other.
 */
export const poseidonHash: HashFn = (values) => {
  if (values.length === 2) return poseidon2(values);
  if (values.length === 4) return poseidon4(values);
  throw new Error(`poseidonHash: unsupported arity ${values.length}`);
};

/**
 * keccak256 over abi.encodePacked(uint256...), matching Solidity exactly.
 *
 * Kept because it is the cheapest hash to verify *on-chain* and needs no
 * dependency, and because `docs/hashing.md` compares the two. It is a poor
 * choice inside a circuit (~150k gates per call vs. ~250 for Poseidon), so it
 * is not the default any more.
 */
export const keccakHash: HashFn = (values) => {
  const packed = encodePacked(
    values.map(() => "uint256"),
    values,
  );
  return mod(BigInt(keccak256(packed)));
};

/**
 * Maps a username to a field element.
 *
 * Hashing rather than reinterpreting the UTF-8 bytes as an integer is a
 * soundness fix, not cosmetics: a raw byte reinterpretation silently wraps for
 * usernames longer than 32 bytes, so two different customers could be handed
 * the same leaf identity and the exchange could drop one of them from the tree
 * without either noticing. (This is the same class of bug the Electisec audit
 * found in Summa's username encoding.)
 */
export function usernameToField(username: string): bigint {
  return mod(BigInt(keccak256(toBytes(username))));
}
