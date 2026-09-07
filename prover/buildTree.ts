/**
 * The custodian-side step: turn the private customer list into one public root
 * plus one private inclusion proof per customer.
 *
 * Usage: npx tsx prover/buildTree.ts [customers.csv] [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readCustomersCsv } from "./csv.ts";
import { poseidonHash } from "./hash.ts";
import { buildTree, createProof, serializeProof, verifyProof } from "./merkleSumTree.ts";

const csvPath = process.argv[2] ?? "./prover/customers.csv";
const outDir = process.argv[3] ?? "./fixtures";

const entries = readCustomersCsv(csvPath);
const tree = buildTree(entries, poseidonHash);

mkdirSync(outDir, { recursive: true });

// Public: the only thing that ever goes on-chain.
writeFileSync(
  `${outDir}/epoch.json`,
  JSON.stringify(
    {
      rootHash: tree.root.hash.toString(),
      totalLiabilities: tree.root.sum.toString(),
      depth: tree.depth,
      leafCount: tree.leaves.length,
      customerCount: entries.length,
    },
    null,
    2,
  ) + "\n",
);

// Private: each customer gets exactly their own file and nobody else's.
let written = 0;
for (const [index, leaf] of tree.leaves.entries()) {
  if (leaf.username === null) continue;
  const proof = createProof(index, tree);
  if (!verifyProof(proof, poseidonHash)) {
    throw new Error(`self-check failed for ${leaf.username}`);
  }
  writeFileSync(`${outDir}/proof-${leaf.username}.json`, serializeProof(proof) + "\n");
  written++;
}

console.log(`customers:         ${entries.length} (padded to ${tree.leaves.length} leaves)`);
console.log(`root hash:         ${tree.root.hash}`);
console.log(`total liabilities: ${tree.root.sum} wei`);
console.log(`wrote:             ${outDir}/epoch.json and ${written} proof files`);
