import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildTree, createProof, verifyProof, keccakHash, type Entry } from "./merkleSumTree.ts";

function parseCustomersCsv(path: string): Entry[] {
  const content = readFileSync(path, "utf8").trim();
  const [, ...rows] = content.split("\n");
  return rows.map((row) => {
    const [username, balance] = row.split(",");
    return { username: username.trim(), balance: BigInt(balance.trim()) };
  });
}

const entries = parseCustomersCsv("./prover/customers.csv");
const { levels, root, entries: padded } = buildTree(entries, keccakHash);

const customerId = "customer-123";
const index = padded.findIndex((e) => e.username === customerId);

if (index === -1) {
  console.log("didn't find customer");
} else {
  const proof = createProof(index, padded, levels);
  console.log("Proof:", proof);
  console.log("Proof valid:", verifyProof(proof, keccakHash));
  console.log("Root:", root);
}

mkdirSync("./fixtures", { recursive: true });
writeFileSync(
  "./fixtures/epoch.json",
  JSON.stringify(
    {
      rootHash: root.hash.toString(),
      totalLiabilities: root.sum.toString(),
    },
    null,
    2,
  ),
);
console.log("Wrote fixtures/epoch.json");
