/**
 * BN254 scalar field. Every value that ends up inside a Merkle-sum-tree node
 * (user ids, balances, hashes) must live in this field, because the ZK circuit
 * and the KZG polynomial commitments both work over it.
 */
export const BN254_FR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Balances are denominated in wei and constrained to this width. 128 bits is
 * chosen because it is a native integer type in both Noir (`u128`) and
 * Solidity, it comfortably covers every realistic wei balance (the entire ETH
 * supply is ~2^87 wei), and a tree of up to 2^126 such leaves still sums to a
 * value that fits in the 254-bit field without wrapping. Values wider than this
 * are rejected by the prover rather than silently reduced.
 */
export const BALANCE_BITS = 128;
export const MAX_BALANCE = (1n << BigInt(BALANCE_BITS)) - 1n;

export function mod(a: bigint, m: bigint = BN254_FR): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}
