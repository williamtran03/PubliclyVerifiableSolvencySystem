import { bn254 } from "@noble/curves/bn254";
import { Fr } from "./field.ts";
import { divideByLinear, evaluate, type Poly } from "./poly.ts";
import { G1, type G1Point, type Srs } from "./srs.ts";

export type Opening = {
  /** The point the polynomial was opened at. */
  z: bigint;
  /** Its value there. */
  value: bigint;
  /** Commitment to the quotient `(p(X) - p(z)) / (X - z)`. */
  proof: G1Point;
};

/**
 * `scalar * point`, tolerating the two cases noble's `multiply` rejects: a zero
 * scalar and the point at infinity.
 */
export function mulPoint(point: G1Point, scalar: bigint): G1Point {
  const reduced = Fr.create(scalar);
  if (Fr.is0(reduced) || point.equals(G1.ZERO)) return G1.ZERO;
  return point.multiply(reduced);
}

/** `[p(tau)]_1`, a single elliptic curve point standing in for the whole polynomial. */
export function commit(srs: Srs, poly: Poly): G1Point {
  if (poly.length > srs.maxDegree + 1) {
    throw new Error(`polynomial of degree ${poly.length - 1} exceeds the SRS (${srs.maxDegree})`);
  }

  let acc = G1.ZERO;
  for (let i = 0; i < poly.length; i++) {
    if (Fr.is0(poly[i])) continue;
    acc = acc.add(mulPoint(srs.g1[i], poly[i]));
  }
  return acc;
}

export function open(srs: Srs, poly: Poly, z: bigint): Opening {
  return { z, value: evaluate(poly, z), proof: commit(srs, divideByLinear(poly, z)) };
}

/**
 * Checks `e(C - [v]_1 + z*pi, [1]_2) * e(-pi, [tau]_2) == 1`.
 *
 * That is the KZG verification equation rearranged into a single product of
 * pairings, which is the only shape the EVM's precompile accepts — so this
 * function and `KzgVerifier.sol` are testing literally the same equation, and
 * the tests assert they agree.
 */
export function verify(srs: Srs, commitment: G1Point, opening: Opening): boolean {
  const left = commitment
    .subtract(mulPoint(G1.BASE, opening.value))
    .add(mulPoint(opening.proof, opening.z));

  const result = bn254.pairingBatch([
    { g1: left, g2: srs.g2 },
    { g1: opening.proof.negate(), g2: srs.tauG2 },
  ]);
  return bn254.fields.Fp12.eql(result, bn254.fields.Fp12.ONE);
}

/**
 * One opening proof for many polynomials at the same point, folded together
 * with powers of `nu`.
 *
 * The range argument opens 130 polynomials at one challenge point; sending 130
 * separate proofs would be silly when a random linear combination of them is
 * just as convincing.
 */
export function batchOpen(srs: Srs, polys: Poly[], z: bigint, nu: bigint): {
  values: bigint[];
  proof: G1Point;
} {
  const values = polys.map((poly) => evaluate(poly, z));

  let combined: Poly = [];
  let power = Fr.ONE;
  for (const poly of polys) {
    const quotient = divideByLinear(poly, z);
    for (let i = 0; i < quotient.length; i++) {
      combined[i] = Fr.add(combined[i] ?? Fr.ZERO, Fr.mul(quotient[i], power));
    }
    power = Fr.mul(power, nu);
  }

  return { values, proof: commit(srs, combined) };
}

export function batchVerify(
  srs: Srs,
  commitments: G1Point[],
  values: bigint[],
  z: bigint,
  nu: bigint,
  proof: G1Point,
): boolean {
  if (commitments.length !== values.length) throw new Error("commitment/value length mismatch");

  let foldedCommitment = G1.ZERO;
  let foldedValue = Fr.ZERO;
  let power = Fr.ONE;
  for (let i = 0; i < commitments.length; i++) {
    foldedCommitment = foldedCommitment.add(mulPoint(commitments[i], power));
    foldedValue = Fr.add(foldedValue, Fr.mul(values[i], power));
    power = Fr.mul(power, nu);
  }

  return verify(srs, foldedCommitment, { z, value: foldedValue, proof });
}
