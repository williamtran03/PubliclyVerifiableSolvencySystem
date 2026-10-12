import { randomBytes } from "node:crypto";
import { Fr, interpolate, nthRootOfUnity } from "./field.ts";
import { add, divideByVanishing, evaluate, evaluateVanishing, mul, scale, sub, type Poly } from "./poly.ts";
import { batchOpen, batchVerify, commit, open, verify } from "./commit.ts";
import { type G1Point, type Srs } from "./srs.ts";
import { Transcript } from "./transcript.ts";

const BALANCE_BITS = 64;
const BIT_BLINDING = 2;
const ACCUMULATOR_BLINDING = 4;

export type LiabilityProof = {
  bits: number;
  bitCommitments: G1Point[];
  accumulatorCommitment: G1Point;
  quotientCommitment: G1Point;
  values: bigint[];
  shiftedAccumulator: bigint;
  proofAtZeta: G1Point;
  proofAtShiftedZeta: G1Point;
};

export const randomScalar = (): bigint => Fr.create(BigInt(`0x${randomBytes(48).toString("hex")}`));

export function vanishingPoly(n: number): Poly {
  return [Fr.neg(Fr.ONE), ...new Array(n - 1).fill(Fr.ZERO), Fr.ONE];
}

export function blind(values: bigint[], coefficients: number): Poly {
  const mask = Array.from({ length: coefficients }, randomScalar);
  return add(interpolate(values), mul(vanishingPoly(values.length), mask));
}

function lagrange(n: number, index: number): Poly {
  return interpolate(Array.from({ length: n }, (_, i) => (i === index ? Fr.ONE : Fr.ZERO)));
}

function shiftArgument(poly: Poly, omega: bigint): Poly {
  let power = Fr.ONE;
  return poly.map((coefficient) => {
    const shifted = Fr.mul(coefficient, power);
    power = Fr.mul(power, omega);
    return shifted;
  });
}

function runningSums(balances: bigint[]): bigint[] {
  const sums: bigint[] = [];
  let acc = 0n;
  for (const balance of balances) {
    sums.push(Fr.create(acc));
    acc += balance;
  }
  return sums;
}

function firstChallenge(
  context: bigint,
  total: bigint,
  balanceCommitment: G1Point,
  bitCommitments: G1Point[],
  accumulatorCommitment: G1Point,
): { transcript: Transcript; gamma: bigint } {
  const transcript = new Transcript("solvency/liabilities/v1");
  transcript.absorbScalar(context);
  transcript.absorbScalar(total);
  transcript.absorbPoint(balanceCommitment);
  for (const commitment of bitCommitments) transcript.absorbPoint(commitment);
  transcript.absorbPoint(accumulatorCommitment);
  return { transcript, gamma: transcript.challenge() };
}

function isDegenerate(zeta: bigint, n: number): boolean {
  return Fr.is0(zeta) || Fr.is0(evaluateVanishing(zeta, n));
}

export function proveLiabilities(
  srs: Srs,
  balancePoly: Poly,
  balances: bigint[],
  total: bigint,
  context: bigint,
  bits: number = BALANCE_BITS,
): LiabilityProof {
  for (const balance of balances) {
    if (balance < 0n || balance >> BigInt(bits) !== 0n) {
      throw new Error(`balance ${balance} does not fit in ${bits} bits`);
    }
  }
  if (balances.reduce((a, b) => a + b, 0n) !== total || total >= Fr.ORDER) {
    throw new Error("the total is not the sum of the balances");
  }

  const n = balances.length;
  const omega = nthRootOfUnity(n);
  const bitPolys = Array.from({ length: bits }, (_, k) =>
    blind(balances.map((balance) => (balance >> BigInt(k)) & 1n), BIT_BLINDING),
  );
  const accumulator = blind(runningSums(balances), ACCUMULATOR_BLINDING);

  const balanceCommitment = commit(srs, balancePoly);
  const bitCommitments = bitPolys.map((poly) => commit(srs, poly));
  const accumulatorCommitment = commit(srs, accumulator);
  const { transcript, gamma } = firstChallenge(context, total, balanceCommitment, bitCommitments, accumulatorCommitment);

  let folded: Poly = [Fr.ZERO];
  let gammaPower = Fr.ONE;
  let reconstructed: Poly = [Fr.ZERO];
  for (let k = 0; k < bits; k++) {
    folded = add(folded, scale(sub(mul(bitPolys[k], bitPolys[k]), bitPolys[k]), gammaPower));
    reconstructed = add(reconstructed, scale(bitPolys[k], Fr.pow(2n, BigInt(k))));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  const last = Fr.pow(omega, BigInt(n - 1));
  const step = sub(sub(shiftArgument(accumulator, omega), accumulator), balancePoly);
  const constraints = [
    sub(reconstructed, balancePoly),
    mul(lagrange(n, 0), accumulator),
    mul([Fr.neg(last), Fr.ONE], step),
    mul(lagrange(n, n - 1), sub(add(accumulator, balancePoly), [Fr.create(total)])),
  ];
  for (const constraint of constraints) {
    folded = add(folded, scale(constraint, gammaPower));
    gammaPower = Fr.mul(gammaPower, gamma);
  }

  const quotient = divideByVanishing(folded, n);
  const quotientCommitment = commit(srs, quotient);
  transcript.absorbPoint(quotientCommitment);
  const zeta = transcript.challenge();
  if (isDegenerate(zeta, n)) throw new Error("degenerate challenge; regenerate the proof");

  const opened = [balancePoly, ...bitPolys, accumulator, quotient];
  const shiftedZeta = Fr.mul(zeta, omega);
  const shiftedAccumulator = evaluate(accumulator, shiftedZeta);
  for (const poly of opened) transcript.absorbScalar(evaluate(poly, zeta));
  transcript.absorbScalar(shiftedAccumulator);
  const nu = transcript.challenge();

  const { values, proof } = batchOpen(srs, opened, zeta, nu);
  return {
    bits,
    bitCommitments,
    accumulatorCommitment,
    quotientCommitment,
    values,
    shiftedAccumulator,
    proofAtZeta: proof,
    proofAtShiftedZeta: open(srs, accumulator, shiftedZeta).proof,
  };
}

export function verifyLiabilities(
  srs: Srs,
  balanceCommitment: G1Point,
  total: bigint,
  n: number,
  proof: LiabilityProof,
  context: bigint,
): boolean {
  if (total < 0n || total >= Fr.ORDER) return false;
  if (!Number.isInteger(proof.bits) || proof.bits < 1) return false;
  if (BigInt(n) * ((1n << BigInt(proof.bits)) - 1n) >= Fr.ORDER) return false;
  if (proof.bitCommitments.length !== proof.bits || proof.values.length !== proof.bits + 3) return false;
  if ([...proof.values, proof.shiftedAccumulator].some((value) => value < 0n || value >= Fr.ORDER)) return false;

  const { transcript, gamma } = firstChallenge(
    context,
    total,
    balanceCommitment,
    proof.bitCommitments,
    proof.accumulatorCommitment,
  );
  transcript.absorbPoint(proof.quotientCommitment);
  const zeta = transcript.challenge();
  if (isDegenerate(zeta, n)) return false;
  for (const value of proof.values) transcript.absorbScalar(value);
  transcript.absorbScalar(proof.shiftedAccumulator);
  const nu = transcript.challenge();

  const omega = nthRootOfUnity(n);
  const last = Fr.pow(omega, BigInt(n - 1));
  const balanceAt = proof.values[0];
  const accumulatorAt = proof.values[proof.bits + 1];
  const quotientAt = proof.values[proof.bits + 2];
  const vanishing = evaluateVanishing(zeta, n);
  const firstLagrange = Fr.div(vanishing, Fr.mul(BigInt(n), Fr.sub(zeta, Fr.ONE)));
  const lastLagrange = Fr.div(Fr.mul(last, vanishing), Fr.mul(BigInt(n), Fr.sub(zeta, last)));

  let left = Fr.ZERO;
  let gammaPower = Fr.ONE;
  let reconstructed = Fr.ZERO;
  for (let k = 0; k < proof.bits; k++) {
    const bit = proof.values[1 + k];
    left = Fr.add(left, Fr.mul(gammaPower, Fr.sub(Fr.mul(bit, bit), bit)));
    reconstructed = Fr.add(reconstructed, Fr.mul(Fr.pow(2n, BigInt(k)), bit));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  const constraints = [
    Fr.sub(reconstructed, balanceAt),
    Fr.mul(firstLagrange, accumulatorAt),
    Fr.mul(Fr.sub(zeta, last), Fr.sub(Fr.sub(proof.shiftedAccumulator, accumulatorAt), balanceAt)),
    Fr.mul(lastLagrange, Fr.sub(Fr.add(accumulatorAt, balanceAt), Fr.create(total))),
  ];
  for (const constraint of constraints) {
    left = Fr.add(left, Fr.mul(gammaPower, constraint));
    gammaPower = Fr.mul(gammaPower, gamma);
  }
  if (!Fr.eql(left, Fr.mul(vanishing, quotientAt))) return false;

  return (
    batchVerify(
      srs,
      [balanceCommitment, ...proof.bitCommitments, proof.accumulatorCommitment, proof.quotientCommitment],
      proof.values,
      zeta,
      nu,
      proof.proofAtZeta,
    ) &&
    verify(srs, proof.accumulatorCommitment, {
      z: Fr.mul(zeta, omega),
      value: proof.shiftedAccumulator,
      proof: proof.proofAtShiftedZeta,
    })
  );
}
