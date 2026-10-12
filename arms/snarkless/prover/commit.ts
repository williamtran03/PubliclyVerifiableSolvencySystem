import { bn254 } from "@noble/curves/bn254";
import { Fr } from "./field.ts";
import { divideByLinear, evaluate, type Poly } from "./poly.ts";
import { G1, type G1Point, type Srs } from "./srs.ts";

export type Opening = {
  z: bigint;
  value: bigint;
  proof: G1Point;
};

export function mulPoint(point: G1Point, scalar: bigint): G1Point {
  const reduced = Fr.create(scalar);
  if (Fr.is0(reduced) || point.equals(G1.ZERO)) return G1.ZERO;
  return point.multiply(reduced);
}

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
