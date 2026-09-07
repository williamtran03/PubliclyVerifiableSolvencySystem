import { G1, type G1Point, type G2Point } from "./srs.ts";
import type { RangeProof } from "./range.ts";
import type { CustomerProof, Epoch } from "./grandSum.ts";

/** Points are written as decimal strings so Foundry's JSON cheatcodes can read them. */
export function g1ToJson(point: G1Point): [string, string] {
  if (point.equals(G1.ZERO)) return ["0", "0"];
  const affine = point.toAffine();
  return [affine.x.toString(), affine.y.toString()];
}

export function g1FromJson(values: [string, string]): G1Point {
  if (values[0] === "0" && values[1] === "0") return G1.ZERO;
  return G1.fromAffine({ x: BigInt(values[0]), y: BigInt(values[1]) });
}

/** G2 coordinates ordered as the EVM's pairing precompile expects them. */
export function g2ToPrecompileJson(point: G2Point): [string, string, string, string] {
  const affine = point.toAffine();
  return [
    affine.x.c1.toString(),
    affine.x.c0.toString(),
    affine.y.c1.toString(),
    affine.y.c0.toString(),
  ];
}

export function rangeProofToJson(proof: RangeProof): string {
  return JSON.stringify(
    {
      bits: proof.bits,
      bitCommitments: proof.bitCommitments.map(g1ToJson),
      quotientCommitment: g1ToJson(proof.quotientCommitment),
      values: proof.values.map((value) => value.toString()),
      batchProof: g1ToJson(proof.batchProof),
    },
    null,
    2,
  );
}

export function rangeProofFromJson(json: string): RangeProof {
  const parsed = JSON.parse(json);
  return {
    bits: parsed.bits,
    bitCommitments: parsed.bitCommitments.map(g1FromJson),
    quotientCommitment: g1FromJson(parsed.quotientCommitment),
    values: parsed.values.map(BigInt),
    batchProof: g1FromJson(parsed.batchProof),
  };
}

export function customerProofToJson(proof: CustomerProof): string {
  return JSON.stringify(
    {
      username: proof.username,
      index: proof.index,
      id: proof.id.toString(),
      balance: proof.balance.toString(),
      proof: g1ToJson(proof.proof),
    },
    null,
    2,
  );
}

export function customerProofFromJson(json: string): CustomerProof {
  const parsed = JSON.parse(json);
  return {
    username: parsed.username,
    index: parsed.index,
    id: BigInt(parsed.id),
    balance: BigInt(parsed.balance),
    proof: g1FromJson(parsed.proof),
  };
}

export function epochToJson(epoch: Omit<Epoch, "rangeProof">): {
  domainSize: string;
  totalLiabilities: string;
  balanceCommitment: [string, string];
  idCommitment: [string, string];
  grandSumProof: [string, string];
} {
  return {
    domainSize: epoch.n.toString(),
    totalLiabilities: epoch.totalLiabilities.toString(),
    balanceCommitment: g1ToJson(epoch.balanceCommitment),
    idCommitment: g1ToJson(epoch.idCommitment),
    grandSumProof: g1ToJson(epoch.grandSumProof),
  };
}
