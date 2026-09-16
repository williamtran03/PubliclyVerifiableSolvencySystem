import { randomBytes } from "node:crypto";
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
import { batchOpen, batchVerify, commit } from "./commit.ts";
import { type G1Point, type Srs } from "./srs.ts";
import { Transcript } from "./transcript.ts";

const BALANCE_BITS = 64;

export type RangeProof = {
  bits: number;
  bitCommitments: G1Point[];
  quotientCommitment: G1Point;
  values: bigint[];
  batchProof: G1Point;
};

const randomScalar = (): bigint => Fr.create(BigInt(`0x${randomBytes(32).toString("hex")}`));

function vanishingPoly(n: number): Poly {
  return [Fr.neg(Fr.ONE), ...new Array(n - 1).fill(Fr.ZERO), Fr.ONE];
}

function bitPolynomials(balances: bigint[], bits: number, n: number): Poly[] {
  const zH = vanishingPoly(n);
  return Array.from({ length: bits }, (_, k) =>
    add(
      interpolate(balances.map((balance) => (balance >> BigInt(k)) & 1n)),
      mul(zH, [randomScalar(), randomScalar()]),
    ),
  );
}

function challenges(
  balanceCommitment: G1Point,
  bitCommitments: G1Point[],
  context: bigint,
): { transcript: Transcript; gamma: bigint } {
  const transcript = new Transcript("solvency/range/v1");
  transcript.absorbScalar(context);
  transcript.absorbPoint(balanceCommitment);
  for (const commitment of bitCommitments) transcript.absorbPoint(commitment);
  return { transcript, gamma: transcript.challenge() };
}

function isDegenerate(zeta: bigint, n: number): boolean {
  return Fr.is0(zeta) || Fr.is0(evaluateVanishing(zeta, n));
}

export function proveRange(
  srs: Srs,
  balancePoly: Poly,
  balances: bigint[],
  context: bigint,
  bits: number = BALANCE_BITS,
): RangeProof {
  for (const balance of balances) {
    if (balance < 0n || balance >> BigInt(bits) !== 0n) {
      throw new Error(`balance ${balance} does not fit in ${bits} bits`);
    }
  }

  const n = balances.length;
  const bitPolys = bitPolynomials(balances, bits, n);
  const balanceCommitment = commit(srs, balancePoly);
  const bitCommitments = bitPolys.map((poly) => commit(srs, poly));

  const { transcript, gamma } = challenges(balanceCommitment, bitCommitments, context);

  let folded: Poly = [Fr.ZERO];
  let gammaPower = Fr.ONE;
  let reconstructed: Poly = [Fr.ZERO];
  for (let k = 0; k < bits; k++) {
    folded = add(folded, scale(sub(mul(bitPolys[k], bitPolys[k]), bitPolys[k]), gammaPower));
    reconstructed = add(reconstructed, scale(bitPolys[k], Fr.pow(2n, BigInt(k))));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  folded = add(folded, scale(sub(reconstructed, balancePoly), gammaPower));

  const quotient = divideByVanishing(folded, n);
  const quotientCommitment = commit(srs, quotient);

  transcript.absorbPoint(quotientCommitment);
  const zeta = transcript.challenge();
  if (isDegenerate(zeta, n)) throw new Error("degenerate challenge; regenerate the proof");

  const opened = [balancePoly, ...bitPolys, quotient];
  for (const poly of opened) transcript.absorbScalar(evaluateAt(poly, zeta));
  const nu = transcript.challenge();

  const { values, proof } = batchOpen(srs, opened, zeta, nu);
  return { bits, bitCommitments, quotientCommitment, values, batchProof: proof };
}

export function verifyRange(
  srs: Srs,
  balanceCommitment: G1Point,
  n: number,
  proof: RangeProof,
  context: bigint,
): boolean {
  if (proof.bitCommitments.length !== proof.bits) return false;
  if (proof.values.length !== proof.bits + 2) return false;

  const { transcript, gamma } = challenges(balanceCommitment, proof.bitCommitments, context);
  transcript.absorbPoint(proof.quotientCommitment);
  const zeta = transcript.challenge();
  if (isDegenerate(zeta, n)) return false;
  for (const value of proof.values) transcript.absorbScalar(value);
  const nu = transcript.challenge();

  const balanceAt = proof.values[0];
  const bitsAt = proof.values.slice(1, 1 + proof.bits);
  const quotientAt = proof.values[proof.values.length - 1];

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
