import { interpolate, Fr } from "./field.ts";
import { commit, open, type Opening } from "./commit.ts";
import type { G1Point, Srs } from "./srs.ts";
import { LEAF_CAPACITY } from "../merkleSumTree.ts";

const GRAND_SUM_CAPACITY = LEAF_CAPACITY;

export type GrandSumEpoch = {
  commitment: G1Point;
  opening: Opening;
  totalLiabilities: bigint;
};

export function buildGrandSumEpoch(srs: Srs, balances: bigint[]): GrandSumEpoch {
  const n = GRAND_SUM_CAPACITY;
  if (balances.length > n) {
    throw new Error(`too many balances (${balances.length}) for domain size ${n}`);
  }
  const padded = [...balances, ...new Array(n - balances.length).fill(0n)];

  const coefficients = interpolate(padded);
  const commitment = commit(srs, coefficients);
  const opening = open(srs, coefficients, 0n);
  const totalLiabilities = Fr.mul(BigInt(n), opening.value);

  return { commitment, opening, totalLiabilities };
}
