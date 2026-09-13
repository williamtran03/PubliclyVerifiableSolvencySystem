import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadSrs, g2ForPrecompile, type G1Point, type G2Point } from "./srs.ts";
import { buildGrandSumEpoch, identityOf, proveInclusion, verifyGrandSum, verifyInclusion, type Account } from "./grandSum.ts";
import { proveRange, verifyRange } from "./range.ts";
import { commit, open } from "./commit.ts";
import { Fr } from "./field.ts";
import { add, mul } from "./poly.ts";

// Columns: username,balance,salt with a header row. The salt is the customer's own.
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

const srs = loadSrs("./arms/snarkless/fixtures/srs.json");
const accounts = parseCustomersCsv("./shared/customers.csv");

const epoch = buildGrandSumEpoch(srs, accounts);
if (!verifyGrandSum(srs, epoch.balanceCommitment, epoch.shiftedCommitment, epoch.opening, epoch.totalLiabilities)) {
  throw new Error("grand sum failed to verify");
}

const rangeProof = proveRange(srs, epoch.balancePoly, epoch.balances);
if (!verifyRange(srs, epoch.balanceCommitment, epoch.balances.length, rangeProof)) {
  throw new Error("range proof failed to verify");
}

const inclusions = accounts.map((account, index) => {
  const inclusion = proveInclusion(srs, epoch, index);
  if (!verifyInclusion(srs, epoch, account, inclusion)) throw new Error(`${account.username} failed inclusion`);
  return {
    username: account.username,
    index,
    identity: identityOf(account.username, account.salt).toString(),
    balance: account.balance.toString(),
    proof: point(inclusion.proof),
  };
});

mkdirSync("./arms/snarkless/fixtures", { recursive: true });
const write = (name: string, value: unknown) =>
  writeFileSync(`./arms/snarkless/fixtures/${name}`, JSON.stringify(value, null, 2) + "\n");

write("epoch.json", {
  domainSize: epoch.balances.length,
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

// The degree-bound attack, kept as a fixture so the registry test can show it is refused:
// p + 5000·Z_H has the same balances on the domain but a constant term 5000 lower.
const vanishing = [Fr.neg(Fr.ONE), ...new Array(epoch.balances.length - 1).fill(0n), Fr.ONE];
const cheat = add(epoch.balancePoly, mul(vanishing, [5000n]));
const cheatOpening = open(srs, cheat, 0n);
const cheatRange = proveRange(srs, cheat, epoch.balances); // still verifies: same balances on the domain
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

console.log(`Wrote arms/snarkless/fixtures/epoch.json (total ${epoch.totalLiabilities}, domain ${epoch.balances.length})`);
console.log(`Wrote arms/snarkless/fixtures/range-proof.json (${rangeProof.bits} bit polynomials)`);
console.log(`Wrote arms/snarkless/fixtures/inclusion.json (${inclusions.length} customers)`);
