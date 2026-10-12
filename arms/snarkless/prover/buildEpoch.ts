import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadSrs, g2ForPrecompile, type G1Point, type G2Point } from "./srs.ts";
import { buildGrandSumEpoch, epochContext, identityOf, proveInclusion, type Account } from "./grandSum.ts";
import { proveLiabilities, vanishingPoly, verifyLiabilities, type LiabilityProof } from "./liabilities.ts";
import { commit } from "./commit.ts";
import { add, mul } from "./poly.ts";

function parseCustomersCsv(path: string): Account[] {
  const content = readFileSync(path, "utf8").trim();
  const [, ...rows] = content.split("\n");
  return rows.map((row) => {
    const [username, balance, , secretCommitment] = row.split(",");
    return { username: username.trim(), balance: BigInt(balance.trim()), secretCommitment: BigInt(secretCommitment.trim()) };
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

const [snapshotPath = "./arms/snarkless/prover/snapshot.json", outDir = "./arms/snarkless/fixtures"] =
  process.argv.slice(2);

const srs = loadSrs("./arms/snarkless/fixtures/srs.json");
const accounts = parseCustomersCsv("./shared/customers.csv");

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const context = epochContext(BigInt(snapshot.chainId), snapshot.registry, BigInt(snapshot.epochId));

const epoch = buildGrandSumEpoch(srs, accounts);
const n = epoch.balances.length;
const liabilityProof = proveLiabilities(srs, epoch.balancePoly, epoch.balances, epoch.totalLiabilities, context);
if (!verifyLiabilities(srs, epoch.balanceCommitment, epoch.totalLiabilities, n, liabilityProof, context)) {
  throw new Error("liability proof failed to verify");
}

const proofJson = (proof: LiabilityProof) => ({
  bitCommitments: proof.bitCommitments.map(point),
  accumulatorCommitment: point(proof.accumulatorCommitment),
  quotientCommitment: point(proof.quotientCommitment),
  values: proof.values.map((v) => v.toString()),
  shiftedAccumulator: proof.shiftedAccumulator.toString(),
  proofAtZeta: point(proof.proofAtZeta),
  proofAtShiftedZeta: point(proof.proofAtShiftedZeta),
});

const inclusions = accounts.map((account, index) => {
  const inclusion = proveInclusion(srs, epoch, index, context);
  return {
    username: account.username,
    index,
    identity: identityOf(account.username, account.secretCommitment).toString(),
    balance: account.balance.toString(),
    proof: point(inclusion.proof),
  };
});

mkdirSync(outDir, { recursive: true });
const write = (name: string, value: unknown) =>
  writeFileSync(`${outDir}/${name}`, JSON.stringify(value, null, 2) + "\n");

write("epoch.json", {
  domainSize: n,
  registry: snapshot.registry,
  chainId: snapshot.chainId,
  epochId: snapshot.epochId,
  context: context.toString(),
  totalLiabilities: epoch.totalLiabilities.toString(),
  balanceCommitment: point(epoch.balanceCommitment),
  identityCommitment: point(epoch.identityCommitment),
  g2: g2Json(srs.g2),
  tauG2: g2Json(srs.tauG2),
});
write("liability-proof.json", { bits: liabilityProof.bits, ...proofJson(liabilityProof) });
write("inclusion.json", inclusions);

const cheat = add(epoch.balancePoly, mul(vanishingPoly(n), [5000n]));
const cheatProof = proveLiabilities(srs, cheat, epoch.balances, epoch.totalLiabilities, context);
if (!verifyLiabilities(srs, commit(srs, cheat), epoch.totalLiabilities, n, cheatProof, context)) {
  throw new Error("the high-degree commitment should still prove its true total");
}
write("attack.json", {
  balanceCommitment: point(commit(srs, cheat)),
  totalLiabilities: epoch.totalLiabilities.toString(),
  understatedTotal: "9550",
  proof: proofJson(cheatProof),
});

console.log(`Wrote ${outDir}/epoch.json (total ${epoch.totalLiabilities}, domain ${n})`);
console.log(`Wrote ${outDir}/liability-proof.json (${liabilityProof.bits} bit polynomials and a running-sum accumulator)`);
console.log(`Wrote ${outDir}/inclusion.json (${inclusions.length} customers)`);
console.log(`Wrote ${outDir}/attack.json (a padded balance polynomial that still proves only the true total)`);
