import { encodeAbiParameters, keccak256 } from "viem";
import { nthRootOfUnity, Fr } from "./field.ts";
import { batchOpen, batchVerify, commit } from "./commit.ts";
import { blind } from "./liabilities.ts";
import type { G1Point, Srs } from "./srs.ts";
import type { Poly } from "./poly.ts";
import { Transcript } from "./transcript.ts";
import { customerSecretCommitment, LEAF_CAPACITY, poseidon2Hash, usernameToBigInt } from "../../../shared/merkleSumTree.ts";

const GRAND_SUM_CAPACITY = LEAF_CAPACITY;
const BALANCE_BLINDING = 2;
const IDENTITY_BLINDING = 1;

export type Account = { username: string; secretCommitment: bigint; balance: bigint };

export type GrandSumEpoch = {
  balanceCommitment: G1Point;
  identityCommitment: G1Point;
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

export function identityOf(username: string, secretCommitment: bigint): bigint {
  return poseidon2Hash([usernameToBigInt(username), secretCommitment]);
}

export function buildGrandSumEpoch(srs: Srs, accounts: Account[]): GrandSumEpoch {
  const n = GRAND_SUM_CAPACITY;
  if (accounts.length > n) {
    throw new Error(`too many balances (${accounts.length}) for domain size ${n}`);
  }

  const balances = [...accounts.map((a) => a.balance), ...new Array(n - accounts.length).fill(0n)];
  const identities = [
    ...accounts.map((a) => identityOf(a.username, a.secretCommitment)),
    ...new Array(n - accounts.length).fill(0n),
  ];

  const totalLiabilities = balances.reduce((a, b) => a + b, 0n);
  if (balances.some((balance) => balance < 0n) || totalLiabilities >= Fr.ORDER) {
    throw new Error("the balances do not fit the field");
  }
  const balancePoly = blind(balances, BALANCE_BLINDING);
  const identityPoly = blind(identities, IDENTITY_BLINDING);

  return {
    balanceCommitment: commit(srs, balancePoly),
    identityCommitment: commit(srs, identityPoly),
    totalLiabilities,
    balancePoly,
    identityPoly,
    balances,
    identities,
  };
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
  customer: { username: string; secret: bigint; balance: bigint },
  inclusion: InclusionProof,
  context: bigint,
): boolean {
  try {
    const { index } = inclusion;
    if (!Number.isInteger(index) || index < 0 || index >= GRAND_SUM_CAPACITY) return false;
    if (customer.balance < 0n || customer.balance >= Fr.ORDER) return false;
    const z = Fr.pow(nthRootOfUnity(GRAND_SUM_CAPACITY), BigInt(index));
    const identity = identityOf(customer.username, customerSecretCommitment(customer.secret));
    const { identityCommitment, balanceCommitment } = commitments;
    const nu = inclusionChallenge(identityCommitment, balanceCommitment, z, identity, customer.balance, context);
    return batchVerify(srs, [identityCommitment, balanceCommitment], [identity, customer.balance], z, nu, inclusion.proof);
  } catch {
    return false;
  }
}
