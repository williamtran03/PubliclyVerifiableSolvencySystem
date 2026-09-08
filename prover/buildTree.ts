import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildTree,
  createProof,
  serializeProof,
  verifyProof,
  poseidon2Hash,
  usernameToBigInt,
  type Entry,
} from "./merkleSumTree.ts";

function parseCustomersCsv(path: string): Entry[] {
  const content = readFileSync(path, "utf8").trim();
  const [, ...rows] = content.split("\n");
  return rows.map((row) => {
    const [username, balance] = row.split(",");
    return { username: username.trim(), balance: BigInt(balance.trim()) };
  });
}

const entries = parseCustomersCsv("./prover/customers.csv");
const { levels, root, entries: padded } = buildTree(entries, poseidon2Hash);

const customerId = "customer-123";
const index = padded.findIndex((e) => e.username === customerId);

if (index === -1) {
  console.log("didn't find customer");
} else {
  const proof = createProof(index, padded, levels);
  console.log("Proof:", proof);
  console.log("Proof valid:", verifyProof(proof, poseidon2Hash));
  console.log("Root:", root);
  writeFileSync(`./fixtures/proof-${customerId}.json`, serializeProof(proof));
  console.log(`Wrote fixtures/proof-${customerId}.json`);
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

// circuit's private witness input, generated so it can't drift from customers.csv
const usernames = padded.map((e) => usernameToBigInt(e.username).toString());
const balances = padded.map((e) => e.balance.toString());
const proverToml = [
  `usernames = [${usernames.map((u) => `"${u}"`).join(", ")}]`,
  `balances = [${balances.map((b) => `"${b}"`).join(", ")}]`,
  "",
].join("\n");
writeFileSync("./circuit/Prover.toml", proverToml);
console.log("Wrote circuit/Prover.toml");
