import { readFileSync, writeFileSync } from "node:fs";
import { loadSrs, type G1Point } from "../prover/srs.ts";
import { buildGrandSumEpoch, epochContext, verifyGrandSum, type Account } from "../prover/grandSum.ts";
import { proveRange, verifyRange } from "../prover/range.ts";

const CHAIN_ID = 31337n;
const ASSETS = 4;
const HARNESS_BASE = 0xbe0c00n;
const REGISTRY_BASE = 0xbe0d00n;

const addressOf = (value: bigint) => `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const point = (p: G1Point) => {
  const affine = p.toAffine();
  return { x: affine.x.toString(), y: affine.y.toString() };
};

const [outPath = "./arms/snarkless/fixtures/bench-assets.json"] = process.argv.slice(2);

const srs = loadSrs("./arms/snarkless/fixtures/srs.json");
const customers: Account[] = readFileSync("./shared/customers.csv", "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((row) => {
    const [username, balance, salt] = row.split(",");
    return { username: username.trim(), balance: BigInt(balance.trim()), salt: BigInt(salt.trim()) };
  });

const balanceSets: bigint[][] = [
  customers.map((c) => c.balance),
  [150_000_000n, 2_750_000_000n, 9_999_999_999n],
  [1n, 18_446_744_073_709_551_615n, 42n],
  [7_000_000n, 0n, 123_456_789_012n],
];

function artifactsFor(accounts: Account[], context: bigint) {
  const epoch = buildGrandSumEpoch(srs, accounts);
  if (!verifyGrandSum(srs, epoch.balanceCommitment, epoch.shiftedCommitment, epoch.opening, epoch.totalLiabilities)) {
    throw new Error("grand sum failed to verify");
  }
  const range = proveRange(srs, epoch.balancePoly, epoch.balances, context);
  if (!verifyRange(srs, epoch.balanceCommitment, epoch.balances.length, range, context)) {
    throw new Error("range proof failed to verify");
  }
  return {
    context: context.toString(),
    sum: {
      balanceCommitment: point(epoch.balanceCommitment),
      shiftedCommitment: point(epoch.shiftedCommitment),
      identityCommitment: point(epoch.identityCommitment),
      totalLiabilities: epoch.totalLiabilities.toString(),
      sumProof: point(epoch.opening.proof),
    },
    range: {
      bitCommitments: range.bitCommitments.map(point),
      quotientCommitment: point(range.quotientCommitment),
      values: range.values.map((v) => v.toString()),
      batchProof: point(range.batchProof),
    },
  };
}

const harness = addressOf(HARNESS_BASE);
const assets = balanceSets.slice(0, ASSETS).map((balances, asset) => {
  const accounts = customers.map((c, i) => ({ ...c, balance: balances[i] }));
  const registry = addressOf(REGISTRY_BASE + BigInt(asset));
  return {
    balances: balances.map(String),
    harness: artifactsFor(accounts, epochContext(CHAIN_ID, harness, BigInt(asset))),
    registry: { address: registry, ...artifactsFor(accounts, epochContext(CHAIN_ID, registry, 0n)) },
  };
});

writeFileSync(outPath, JSON.stringify({ chainId: CHAIN_ID.toString(), harness, assets }, null, 2) + "\n");
console.log(`Wrote ${outPath} (${assets.length} assets, harness ${harness})`);
