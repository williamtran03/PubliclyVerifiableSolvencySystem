import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { LEAF_CAPACITY, type Entry } from "../merkleSumTree.ts";
import { loadSrs, g2ForPrecompile, type G1Point } from "./srs.ts";
import { buildGrandSumEpoch } from "./grandSum.ts";
import { proveRange, verifyRange } from "./range.ts";
import { verify } from "./commit.ts";
import { interpolate } from "./field.ts";

function parseCustomersCsv(path: string): Entry[] {
  const content = readFileSync(path, "utf8").trim();
  const [, ...rows] = content.split("\n");
  return rows.map((row) => {
    const [username, balance, salt] = row.split(",");
    return {
      username: username.trim(),
      balance: BigInt(balance.trim()),
      salt: BigInt(salt.trim()),
    };
  });
}

const point = (p: G1Point) => {
  const affine = p.toAffine();
  return { x: affine.x.toString(), y: affine.y.toString() };
};

const srs = loadSrs("./fixtures/kzg/srs.json");
const entries = parseCustomersCsv("./prover/customers.csv");

const balances = entries.map((e) => e.balance);
const padded = [...balances, ...new Array(LEAF_CAPACITY - balances.length).fill(0n)];

const epoch = buildGrandSumEpoch(srs, balances);
if (!verify(srs, epoch.commitment, epoch.opening)) throw new Error("grand sum opening failed to verify");

const balancePoly = interpolate(padded);
const rangeProof = proveRange(srs, balancePoly, padded);
if (!verifyRange(srs, epoch.commitment, LEAF_CAPACITY, rangeProof)) {
  throw new Error("range proof failed to verify");
}

const serializedRange = JSON.stringify(
  {
    bits: rangeProof.bits,
    bitCommitments: rangeProof.bitCommitments.map(point),
    quotientCommitment: point(rangeProof.quotientCommitment),
    values: rangeProof.values.map((v) => v.toString()),
    batchProof: point(rangeProof.batchProof),
  },
  null,
  2,
);

mkdirSync("./fixtures/kzg", { recursive: true });
writeFileSync("./fixtures/kzg/kzg-range-proof.json", serializedRange + "\n");

const [g2xImag, g2xReal, g2yImag, g2yReal] = g2ForPrecompile(srs.g2);
const [tauxImag, tauxReal, tauyImag, tauyReal] = g2ForPrecompile(srs.tauG2);

const epochJson = {
  domainSize: LEAF_CAPACITY,
  totalLiabilities: epoch.totalLiabilities.toString(),
  commitment: point(epoch.commitment),
  z: epoch.opening.z.toString(),
  value: epoch.opening.value.toString(),
  proof: point(epoch.opening.proof),
  rangeProofHash: keccak256(toHex(serializedRange)),
  g2: { xImag: g2xImag.toString(), xReal: g2xReal.toString(), yImag: g2yImag.toString(), yReal: g2yReal.toString() },
  tauG2: { xImag: tauxImag.toString(), xReal: tauxReal.toString(), yImag: tauyImag.toString(), yReal: tauyReal.toString() },
};

writeFileSync("./fixtures/kzg/kzg-epoch.json", JSON.stringify(epochJson, null, 2) + "\n");

console.log(`Wrote fixtures/kzg/kzg-epoch.json (total ${epoch.totalLiabilities}, domain ${LEAF_CAPACITY})`);
console.log(`Wrote fixtures/kzg/kzg-range-proof.json (${rangeProof.bits} bit polynomials)`);
