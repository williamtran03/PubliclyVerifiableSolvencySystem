import { BALANCE_BITS } from "../field.ts";
import { Fr, interpolate } from "./field.ts";
import {
  add,
  divideByVanishing,
  evaluateVanishing,
  mul,
  scale,
  sub,
  type Poly,
} from "./poly.ts";
import { batchOpen, batchVerify, commit, type Opening } from "./commit.ts";
import { G1, type G1Point, type Srs } from "./srs.ts";
import { Transcript } from "./transcript.ts";

/**
 * Proof that every balance committed to is a genuine `BALANCE_BITS`-bit number.
 *
 * This is the part a grand sum on its own cannot give you. Balances live in a
 * prime field, where "minus ten" is an enormous positive number; a custodian
 * could park one in an unused slot to cancel a real customer's balance and
 * publish a total smaller than what it owes. Every KZG opening would still
 * verify, because the arithmetic really is consistent — it is just consistent
 * with a lie.
 *
 * The argument, in full:
 *
 *   1. commit to one polynomial `b_k` per bit position, where `b_k(w^i)` is bit
 *      k of customer i's balance;
 *   2. every `b_k` really is boolean: `b_k(X)^2 - b_k(X)` vanishes on H;
 *   3. the bits reconstruct the balances: `sum_k 2^k b_k(X) - p(X)` vanishes on H;
 *   4. fold (2) and (3) into one polynomial with a challenge `gamma`, and show
 *      the fold is divisible by `Z_H(X) = X^n - 1` — which it is precisely when
 *      every one of those identities holds at every leaf;
 *   5. prove that divisibility by opening both sides at a challenge point.
 *
 * There is no circuit and no SNARK anywhere in that list: it is polynomial
 * identity testing plus KZG openings, which is exactly what makes it cheap
 * enough to verify without a proving system.
 */
export type RangeProof = {
  bits: number;
  bitCommitments: G1Point[];
  quotientCommitment: G1Point;
  /** Evaluations at the challenge point: `[p, b_0..b_{bits-1}, Q]`. */
  values: bigint[];
  batchProof: G1Point;
};

function bitPolynomials(balances: bigint[], bits: number): Poly[] {
  return Array.from({ length: bits }, (_, k) =>
    interpolate(balances.map((balance) => (balance >> BigInt(k)) & 1n)),
  );
}

/**
 * Rebuilds the challenges from the commitments, so prover and verifier derive
 * them the same way by construction rather than by convention.
 */
function challenges(
  balanceCommitment: G1Point,
  bitCommitments: G1Point[],
): { transcript: Transcript; gamma: bigint } {
  const transcript = new Transcript("solvency/range/v1");
  transcript.absorbPoint(balanceCommitment);
  for (const commitment of bitCommitments) transcript.absorbPoint(commitment);
  return { transcript, gamma: transcript.challenge() };
}

export function proveRange(
  srs: Srs,
  balancePoly: Poly,
  balances: bigint[],
  bits: number = BALANCE_BITS,
): RangeProof {
  for (const balance of balances) {
    if (balance < 0n || balance >> BigInt(bits) !== 0n) {
      throw new Error(`balance ${balance} does not fit in ${bits} bits`);
    }
  }

  const n = balances.length;
  const bitPolys = bitPolynomials(balances, bits);
  const balanceCommitment = commit(srs, balancePoly);
  const bitCommitments = bitPolys.map((poly) => commit(srs, poly));

  const { transcript, gamma } = challenges(balanceCommitment, bitCommitments);

  // sum_k gamma^k (b_k^2 - b_k)  +  gamma^bits (sum_k 2^k b_k - p)
  let folded: Poly = [Fr.ZERO];
  let gammaPower = Fr.ONE;
  let reconstructed: Poly = [Fr.ZERO];
  for (let k = 0; k < bits; k++) {
    folded = add(folded, scale(sub(mul(bitPolys[k], bitPolys[k]), bitPolys[k]), gammaPower));
    reconstructed = add(reconstructed, scale(bitPolys[k], Fr.pow(2n, BigInt(k))));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  folded = add(folded, scale(sub(reconstructed, balancePoly), gammaPower));

  // Throws unless every identity holds at every leaf.
  const quotient = divideByVanishing(folded, n);
  const quotientCommitment = commit(srs, quotient);

  transcript.absorbPoint(quotientCommitment);
  const zeta = transcript.challenge();

  const opened = [balancePoly, ...bitPolys, quotient];
  const preliminary = opened.map((poly) => evaluateAt(poly, zeta));
  for (const value of preliminary) transcript.absorbScalar(value);
  const nu = transcript.challenge();

  const { values, proof } = batchOpen(srs, opened, zeta, nu);
  return { bits, bitCommitments, quotientCommitment, values, batchProof: proof };
}

export function verifyRange(
  srs: Srs,
  balanceCommitment: G1Point,
  n: number,
  proof: RangeProof,
): boolean {
  if (proof.bitCommitments.length !== proof.bits) return false;
  if (proof.values.length !== proof.bits + 2) return false;

  const { transcript, gamma } = challenges(balanceCommitment, proof.bitCommitments);
  transcript.absorbPoint(proof.quotientCommitment);
  const zeta = transcript.challenge();
  for (const value of proof.values) transcript.absorbScalar(value);
  const nu = transcript.challenge();

  const balanceAt = proof.values[0];
  const bitsAt = proof.values.slice(1, 1 + proof.bits);
  const quotientAt = proof.values[proof.values.length - 1];

  // The identity, evaluated at a point the prover could not predict.
  let left = Fr.ZERO;
  let gammaPower = Fr.ONE;
  let reconstructed = Fr.ZERO;
  for (let k = 0; k < proof.bits; k++) {
    const bit = bitsAt[k];
    left = Fr.add(left, Fr.mul(gammaPower, Fr.sub(Fr.mul(bit, bit), bit)));
    reconstructed = Fr.add(reconstructed, Fr.mul(Fr.pow(2n, BigInt(k)), bit));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  left = Fr.add(left, Fr.mul(gammaPower, Fr.sub(reconstructed, balanceAt)));

  if (!Fr.eql(left, Fr.mul(evaluateVanishing(zeta, n), quotientAt))) return false;

  // ...and the evaluations really are the committed polynomials' values there.
  return batchVerify(
    srs,
    [balanceCommitment, ...proof.bitCommitments, proof.quotientCommitment],
    proof.values,
    zeta,
    nu,
    proof.batchProof,
  );
}

function evaluateAt(poly: Poly, z: bigint): bigint {
  let result = Fr.ZERO;
  for (let i = poly.length - 1; i >= 0; i--) result = Fr.add(Fr.mul(result, z), poly[i]);
  return result;
}

export { G1 };
export type { Opening };
