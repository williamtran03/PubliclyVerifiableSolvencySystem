import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadSrs, g2ForPrecompile, type G1Point, type G2Point } from "./srs.ts";
import {
  buildGrandSumEpoch,
  epochContext,
  identityOf,
  proveInclusion,
  verifyGrandSum,
  verifyInclusion,
  type Account,
} from "./grandSum.ts";
import { proveRange, verifyRange } from "./range.ts";
import { commit, open } from "./commit.ts";
import { Fr } from "./field.ts";
import { add, mul } from "./poly.ts";

function parseCustomersCsv(path: string): Account[] {
  const content = readFileSync(path, "utf8").trim();
  const [, ...rows] = content.split("\n");
  return rows.map((row) => {
    const [username, balance, salt] = row.split(",");
    return { username: username.trim(), balance: BigInt(balance.trim()), salt: BigInt(salt.trim()) };
  });
}

const point = (p: G1Point) => {
  const affine = p.toAffine();
  return { x: affine.x.toString(), y: affine.y.toString() };
};

const g2Json = (p: G2Point) => {
  const [xImag, xReal, yImag, yReal] = g2ForPrecompile(p).map(String);
  return { xImag, xReal, yImag, yReal };
};

// Optional positional arguments let a deployment bind its proofs to its own
// registry address; both default to the committed fixtures the tests read.
const [snapshotPath = "./arms/snarkless/prover/snapshot.json", outDir = "./arms/snarkless/fixtures"] =
  process.argv.slice(2);

const srs = loadSrs("./arms/snarkless/fixtures/srs.json");
const accounts = parseCustomersCsv("./shared/customers.csv");

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const context = epochContext(BigInt(snapshot.chainId), snapshot.registry, BigInt(snapshot.epochId));

const epoch = buildGrandSumEpoch(srs, accounts);
if (!verifyGrandSum(srs, epoch.balanceCommitment, epoch.shiftedCommitment, epoch.opening, epoch.totalLiabilities)) {
  throw new Error("grand sum failed to verify");
}

const rangeProof = proveRange(srs, epoch.balancePoly, epoch.balances, context);
if (!verifyRange(srs, epoch.balanceCommitment, epoch.balances.length, rangeProof, context)) {
  throw new Error("range proof failed to verify");
}

const inclusions = accounts.map((account, index) => {
  const inclusion = proveInclusion(srs, epoch, index, context);
  if (!verifyInclusion(srs, epoch, account, inclusion, context)) {
    throw new Error(`${account.username} failed inclusion`);
  }
  return {
    username: account.username,
    index,
    identity: identityOf(account.username, account.salt).toString(),
    balance: account.balance.toString(),
    proof: point(inclusion.proof),
  };
});

mkdirSync(outDir, { recursive: true });
const write = (name: string, value: unknown) =>
  writeFileSync(`${outDir}/${name}`, JSON.stringify(value, null, 2) + "\n");

write("epoch.json", {
  domainSize: epoch.balances.length,
  registry: snapshot.registry,
  chainId: snapshot.chainId,
  epochId: snapshot.epochId,
  context: context.toString(),
  totalLiabilities: epoch.totalLiabilities.toString(),
  balanceCommitment: point(epoch.balanceCommitment),
  shiftedCommitment: point(epoch.shiftedCommitment),
  identityCommitment: point(epoch.identityCommitment),
  sumProof: point(epoch.opening.proof),
  constantTerm: epoch.opening.value.toString(),
  g2: g2Json(srs.g2),
  tauG2: g2Json(srs.tauG2),
  boundG2: g2Json(srs.boundG2),
});
write("range-proof.json", {
  bits: rangeProof.bits,
  bitCommitments: rangeProof.bitCommitments.map(point),
  quotientCommitment: point(rangeProof.quotientCommitment),
  values: rangeProof.values.map((v) => v.toString()),
  batchProof: point(rangeProof.batchProof),
});
write("inclusion.json", inclusions);

const vanishing = [Fr.neg(Fr.ONE), ...new Array(epoch.balances.length - 1).fill(0n), Fr.ONE];
const cheat = add(epoch.balancePoly, mul(vanishing, [5000n]));
const cheatOpening = open(srs, cheat, 0n);
const cheatRange = proveRange(srs, cheat, epoch.balances, context);
write("attack.json", {
  balanceCommitment: point(commit(srs, cheat)),
  sumProof: point(cheatOpening.proof),
  constantTerm: cheatOpening.value.toString(),
  totalLiabilities: Fr.mul(BigInt(epoch.balances.length), cheatOpening.value).toString(),
  range: {
    bitCommitments: cheatRange.bitCommitments.map(point),
    quotientCommitment: point(cheatRange.quotientCommitment),
    values: cheatRange.values.map((v) => v.toString()),
    batchProof: point(cheatRange.batchProof),
  },
});

console.log(`Wrote ${outDir}/epoch.json (total ${epoch.totalLiabilities}, domain ${epoch.balances.length})`);
console.log(`Wrote ${outDir}/range-proof.json (${rangeProof.bits} bit polynomials)`);
console.log(`Wrote ${outDir}/inclusion.json (${inclusions.length} customers)`);
console.log(`Wrote ${outDir}/attack.json (degree-bound forgery the tests must reject)`);
