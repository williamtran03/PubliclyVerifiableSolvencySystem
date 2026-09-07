/**
 * The custodian-side step for the snarkless protocol.
 *
 *   customers.csv -> balance/id polynomials -> commitments
 *                 -> grand sum opening at zero      (verified on-chain)
 *                 -> range argument                 (verified off-chain, hashed on-chain)
 *                 -> one opening per customer       (verified by that customer)
 *
 * Usage: npx tsx script/commit.ts [customers.csv] [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { readCustomersCsv } from "../prover/csv.ts";
import { Fr, nthRootOfUnity } from "../prover/kzg/field.ts";
import { buildEpoch, verifyCustomerProof, verifyEpoch } from "../prover/kzg/grandSum.ts";
import {
  customerProofToJson,
  epochToJson,
  g1ToJson,
  g2ToPrecompileJson,
  rangeProofToJson,
} from "../prover/kzg/json.ts";
import { loadSrs } from "../prover/kzg/srs.ts";

const csvPath = process.argv[2] ?? "./prover/customers.csv";
const outDir = process.argv[3] ?? "./fixtures";

const srs = loadSrs("fixtures/srs.json");
const entries = readCustomersCsv(csvPath);
const { epoch, proofs } = buildEpoch(srs, entries);

// Self-check before anything is written: a fixture that does not verify is
// worse than no fixture, because the failure shows up somewhere else.
const verified = verifyEpoch(srs, epoch);
if (!verified.ok) throw new Error(`self-check failed: ${JSON.stringify(verified.checks)}`);
for (const proof of proofs) {
  if (!verifyCustomerProof(srs, epoch, proof)) {
    throw new Error(`self-check failed for ${proof.username}`);
  }
}

mkdirSync(outDir, { recursive: true });

// The range argument is published as a file and committed to on-chain by hash,
// so the chain pins exactly one artifact while the (large) verification of it
// stays off-chain and free.
const rangeProofJson = rangeProofToJson(epoch.rangeProof) + "\n";
writeFileSync(`${outDir}/range-proof.json`, rangeProofJson);
const rangeProofHash = keccak256(toBytes(rangeProofJson));

writeFileSync(
  `${outDir}/kzg-epoch.json`,
  JSON.stringify(
    {
      ...epochToJson(epoch),
      rangeProofHash,
      customerCount: entries.length,
      // Deployment parameters, so the contract and the prover cannot disagree
      // about which domain the polynomials live on.
      omega: nthRootOfUnity(epoch.n).toString(),
      domainSizeInverse: Fr.inv(Fr.create(BigInt(epoch.n))).toString(),
      g2: g2ToPrecompileJson(srs.g2),
      tauG2: g2ToPrecompileJson(srs.tauG2),
      // One customer inlined, so the Foundry tests need only this file.
      sample: JSON.parse(customerProofToJson(proofs[0])),
    },
    null,
    2,
  ) + "\n",
);

for (const proof of proofs) {
  writeFileSync(`${outDir}/kzg-proof-${proof.username}.json`, customerProofToJson(proof) + "\n");
}

console.log(`customers:         ${entries.length} (domain size ${epoch.n})`);
console.log(`balance commitment: (${g1ToJson(epoch.balanceCommitment).join(", ")})`);
console.log(`total liabilities: ${epoch.totalLiabilities} wei`);
console.log(`range proof:       ${epoch.rangeProof.bits} bit polynomials, ${rangeProofJson.length} bytes, ${rangeProofHash}`);
console.log(`wrote:             ${outDir}/kzg-epoch.json, range-proof.json and ${proofs.length} customer proofs`);
