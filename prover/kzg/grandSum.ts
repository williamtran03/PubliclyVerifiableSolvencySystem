import { encodeAbiParameters, keccak256 } from "viem";
import { toLeaves, type Entry, type Leaf } from "../merkleSumTree.ts";
import { batchOpen, batchVerify, commit, mulPoint, open, verify } from "./commit.ts";
import { Fr, domain, interpolate } from "./field.ts";
import { proveRange, verifyRange, type RangeProof } from "./range.ts";
import { G1, type G1Point, type Srs } from "./srs.ts";

/**
 * A published epoch, in the "grand sum" style of Summa V2: the custodian's
 * liabilities are one polynomial, and the total is one opening of it.
 *
 * The trick that makes this work is a property of roots of unity. Interpolate
 * the balances so that `p(w^i)` is customer i's balance; then
 *
 *     sum_i p(w^i) = n * p(0)
 *
 * because every non-constant term sums to zero around the circle. So proving
 * the total means opening the commitment at a single point — zero — and the
 * verifier does one pairing check. No circuit, no SNARK, no per-circuit setup.
 */
export type Epoch = {
  n: number;
  totalLiabilities: bigint;
  balanceCommitment: G1Point;
  idCommitment: G1Point;
  /** Opening of the balance polynomial at 0; its value is `total / n` in Fr. */
  grandSumProof: G1Point;
  rangeProof: RangeProof;
};

/** What one customer needs to check their own balance is inside the total. */
export type CustomerProof = {
  username: string;
  index: number;
  id: bigint;
  balance: bigint;
  /** One batched opening of both commitments at `w^index`. */
  proof: G1Point;
};

export type BuiltEpoch = {
  epoch: Epoch;
  leaves: Leaf[];
  proofs: CustomerProof[];
};

/**
 * The challenge that folds the two commitments into one opening.
 *
 * Derived from everything the fold depends on, and identical to what
 * `KzgSolvencyRegistry.inclusionChallenge` computes, so a proof made here
 * verifies on-chain without either side being told the challenge.
 */
export function inclusionChallenge(
  balanceCommitment: G1Point,
  idCommitment: G1Point,
  index: number,
  id: bigint,
  balance: bigint,
): bigint {
  const [b, u] = [balanceCommitment.toAffine(), idCommitment.toAffine()];
  const encoded = encodeAbiParameters(
    [
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ],
    [b.x, b.y, u.x, u.y, BigInt(index), id, balance],
  );
  return Fr.create(BigInt(keccak256(encoded)));
}

export function buildEpoch(srs: Srs, entries: Entry[]): BuiltEpoch {
  const leaves = toLeaves(entries);
  const n = leaves.length;

  const balances = leaves.map((leaf) => leaf.balance);
  const ids = leaves.map((leaf) => leaf.id);
  const balancePoly = interpolate(balances);
  const idPoly = interpolate(ids);

  const balanceCommitment = commit(srs, balancePoly);
  const idCommitment = commit(srs, idPoly);

  const totalLiabilities = balances.reduce((a, b) => a + b, 0n);
  // Integer sum and field sum agree because n * 2^128 is far below the field
  // size; if that ever stops holding, this catches it.
  if (!Fr.eql(Fr.mul(balancePoly[0], BigInt(n)), Fr.create(totalLiabilities))) {
    throw new Error("grand sum identity failed: the balances do not fit the field");
  }

  const grandSum = open(srs, balancePoly, 0n);
  const points = domain(n);
  const proofs: CustomerProof[] = [];

  for (const [index, leaf] of leaves.entries()) {
    if (leaf.username === null) continue;
    const nu = inclusionChallenge(balanceCommitment, idCommitment, index, leaf.id, leaf.balance);
    const { proof } = batchOpen(srs, [balancePoly, idPoly], points[index], nu);
    proofs.push({ username: leaf.username, index, id: leaf.id, balance: leaf.balance, proof });
  }

  return {
    epoch: {
      n,
      totalLiabilities,
      balanceCommitment,
      idCommitment,
      grandSumProof: grandSum.proof,
      rangeProof: proveRange(srs, balancePoly, balances),
    },
    leaves,
    proofs,
  };
}

/**
 * Everything a verifier can check about a published epoch without knowing a
 * single customer's balance.
 */
export function verifyEpoch(srs: Srs, epoch: Epoch): { ok: boolean; checks: Record<string, boolean> } {
  const grandSum = verify(srs, epoch.balanceCommitment, {
    z: 0n,
    value: Fr.mul(Fr.create(epoch.totalLiabilities), Fr.inv(Fr.create(BigInt(epoch.n)))),
    proof: epoch.grandSumProof,
  });
  const range = verifyRange(srs, epoch.balanceCommitment, epoch.n, epoch.rangeProof);

  return { ok: grandSum && range, checks: { grandSum, range } };
}

export function verifyCustomerProof(srs: Srs, epoch: Epoch, proof: CustomerProof): boolean {
  const nu = inclusionChallenge(
    epoch.balanceCommitment,
    epoch.idCommitment,
    proof.index,
    proof.id,
    proof.balance,
  );
  return batchVerify(
    srs,
    [epoch.balanceCommitment, epoch.idCommitment],
    [proof.balance, proof.id],
    domain(epoch.n)[proof.index],
    nu,
    proof.proof,
  );
}

export { G1, mulPoint };
