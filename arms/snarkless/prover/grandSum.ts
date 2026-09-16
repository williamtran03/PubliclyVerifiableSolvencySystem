import { encodeAbiParameters, keccak256 } from "viem";
import { interpolate, nthRootOfUnity, Fr } from "./field.ts";
import { batchOpen, batchVerify, commit, commitShifted, open, verify, verifyDegreeBound, type Opening } from "./commit.ts";
import type { G1Point, Srs } from "./srs.ts";
import type { Poly } from "./poly.ts";
import { Transcript } from "./transcript.ts";
import { LEAF_CAPACITY, poseidon2Hash, usernameToBigInt } from "../../../shared/merkleSumTree.ts";

const GRAND_SUM_CAPACITY = LEAF_CAPACITY;

export type Account = { username: string; salt: bigint; balance: bigint };

export type GrandSumEpoch = {
  balanceCommitment: G1Point;
  shiftedCommitment: G1Point;
  identityCommitment: G1Point;
  opening: Opening;
  totalLiabilities: bigint;
  balancePoly: Poly;
  identityPoly: Poly;
  balances: bigint[];
  identities: bigint[];
};

export type InclusionProof = { index: number; proof: G1Point };

export function epochContext(chainId: bigint, registry: `0x${string}`, epochId: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [chainId, registry, epochId],
  );
  return BigInt(keccak256(encoded)) % Fr.ORDER;
}

export function identityOf(username: string, salt: bigint): bigint {
  return poseidon2Hash([usernameToBigInt(username), salt]);
}

export function buildGrandSumEpoch(srs: Srs, accounts: Account[]): GrandSumEpoch {
  const n = GRAND_SUM_CAPACITY;
  if (accounts.length > n) {
    throw new Error(`too many balances (${accounts.length}) for domain size ${n}`);
  }
  if (srs.boundedDegree !== n - 1) throw new Error(`the SRS must bound degree ${n - 1}`);

  const balances = [...accounts.map((a) => a.balance), ...new Array(n - accounts.length).fill(0n)];
  const identities = [
    ...accounts.map((a) => identityOf(a.username, a.salt)),
    ...new Array(n - accounts.length).fill(0n),
  ];

  const balancePoly = interpolate(balances);
  const identityPoly = interpolate(identities);
  const opening = open(srs, balancePoly, 0n);
  const totalLiabilities = Fr.mul(BigInt(n), opening.value);

  const plainSum = balances.reduce((a, b) => a + b, 0n);
  if (totalLiabilities !== plainSum) throw new Error("the balances do not fit the field");

  return {
    balanceCommitment: commit(srs, balancePoly),
    shiftedCommitment: commitShifted(srs, balancePoly),
    identityCommitment: commit(srs, identityPoly),
    opening,
    totalLiabilities,
    balancePoly,
    identityPoly,
    balances,
    identities,
  };
}

export function verifyGrandSum(
  srs: Srs,
  balanceCommitment: G1Point,
  shiftedCommitment: G1Point,
  opening: Opening,
  totalLiabilities: bigint,
): boolean {
  return (
    opening.z === 0n &&
    totalLiabilities < Fr.ORDER &&
    Fr.eql(Fr.mul(BigInt(GRAND_SUM_CAPACITY), opening.value), totalLiabilities) &&
    verifyDegreeBound(srs, balanceCommitment, shiftedCommitment) &&
    verify(srs, balanceCommitment, opening)
  );
}

function inclusionChallenge(
  identityCommitment: G1Point,
  balanceCommitment: G1Point,
  z: bigint,
  identity: bigint,
  balance: bigint,
  context: bigint,
): bigint {
  const transcript = new Transcript("solvency/inclusion/v1");
  transcript.absorbScalar(context);
  transcript.absorbPoint(identityCommitment);
  transcript.absorbPoint(balanceCommitment);
  transcript.absorbScalar(z);
  transcript.absorbScalar(identity);
  transcript.absorbScalar(balance);
  return transcript.challenge();
}

export function proveInclusion(srs: Srs, epoch: GrandSumEpoch, index: number, context: bigint): InclusionProof {
  if (!Number.isInteger(index) || index < 0 || index >= GRAND_SUM_CAPACITY) throw new Error("index outside the domain");
  const z = Fr.pow(nthRootOfUnity(GRAND_SUM_CAPACITY), BigInt(index));
  const nu = inclusionChallenge(
    epoch.identityCommitment,
    epoch.balanceCommitment,
    z,
    epoch.identities[index],
    epoch.balances[index],
    context,
  );
  const { values, proof } = batchOpen(srs, [epoch.identityPoly, epoch.balancePoly], z, nu);
  if (values[0] !== epoch.identities[index] || values[1] !== epoch.balances[index]) {
    throw new Error("slot does not open to its own identity and balance");
  }
  return { index, proof };
}

export function verifyInclusion(
  srs: Srs,
  commitments: { identityCommitment: G1Point; balanceCommitment: G1Point },
  customer: Account,
  inclusion: InclusionProof,
  context: bigint,
): boolean {
  try {
    const { index } = inclusion;
    if (!Number.isInteger(index) || index < 0 || index >= GRAND_SUM_CAPACITY) return false;
    if (customer.balance < 0n || customer.balance >= Fr.ORDER) return false;
    const z = Fr.pow(nthRootOfUnity(GRAND_SUM_CAPACITY), BigInt(index));
    const identity = identityOf(customer.username, customer.salt);
    const { identityCommitment, balanceCommitment } = commitments;
    const nu = inclusionChallenge(identityCommitment, balanceCommitment, z, identity, customer.balance, context);
    return batchVerify(srs, [identityCommitment, balanceCommitment], [identity, customer.balance], z, nu, inclusion.proof);
  } catch {
    return false;
  }
}
