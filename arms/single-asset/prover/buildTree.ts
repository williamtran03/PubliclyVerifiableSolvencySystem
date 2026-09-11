import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildTree,
  createProof,
  serializeProof,
  verifyProof,
  poseidon2Hash,
  usernameToBigInt,
  type Entry,
} from "../../../shared/merkleSumTree.ts";

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

const entries = parseCustomersCsv("./shared/customers.csv");
const { levels, root, entries: padded } = buildTree(entries, poseidon2Hash);

mkdirSync("./arms/single-asset/fixtures", { recursive: true });

const customerId = "customer-123";
const index = padded.findIndex((e) => e.username === customerId);

if (index === -1) {
  console.log("didn't find customer");
} else {
  const proof = createProof(index, padded, levels);
  console.log("Proof valid:", verifyProof(proof, poseidon2Hash));
  writeFileSync(`./arms/single-asset/fixtures/proof-${customerId}.json`, serializeProof(proof));
  console.log(`Wrote arms/single-asset/fixtures/proof-${customerId}.json`);
}

mkdirSync("./arms/single-asset/site/public/proofs", { recursive: true });
const realUsernames = entries.map((e) => e.username);
for (const username of realUsernames) {
  const i = padded.findIndex((e) => e.username === username);
  writeFileSync(`./arms/single-asset/site/public/proofs/${username}.json`, serializeProof(createProof(i, padded, levels)));
}
writeFileSync("./arms/single-asset/site/public/proofs/index.json", JSON.stringify(realUsernames, null, 2));
console.log(`Wrote arms/single-asset/site/public/proofs/ (${realUsernames.length} customers)`);

writeFileSync(
  "./arms/single-asset/fixtures/epoch.json",
  JSON.stringify(
    {
      rootHash: root.hash.toString(),
      totalLiabilities: root.sum.toString(),
    },
    null,
    2,
  ),
);
console.log("Wrote arms/single-asset/fixtures/epoch.json");

const usernames = padded.map((e) => usernameToBigInt(e.username).toString());
const salts = padded.map((e) => e.salt.toString());
const balances = padded.map((e) => e.balance.toString());
const totalAssets = process.env.ASSETS ?? "50000";
if (BigInt(totalAssets) < root.sum) {
  throw new Error(`ASSETS ${totalAssets} is below liabilities ${root.sum}: the circuit will reject this`);
}

const proverToml = [
  `usernames = [${usernames.map((u) => `"${u}"`).join(", ")}]`,
  `salts = [${salts.map((s) => `"${s}"`).join(", ")}]`,
  `balances = [${balances.map((b) => `"${b}"`).join(", ")}]`,
  `total_assets = "${totalAssets}"`,
  "",
].join("\n");
writeFileSync("./arms/single-asset/circuit/Prover.toml", proverToml);
console.log("Wrote arms/single-asset/circuit/Prover.toml");
