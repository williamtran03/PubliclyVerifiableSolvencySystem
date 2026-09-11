import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { usernameToBigInt, LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";
import {
  buildTree,
  createProof,
  serializeBundle,
  NUM_ASSETS,
  MAX_U64,
  type Holding,
} from "./multiAssetTree.ts";

function parseHoldingsCsv(path: string): Holding[] {
  const [, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  return rows.map((row) => {
    const [username, salt, assetId, amount] = row.split(",");
    const holding = {
      username: username.trim(),
      salt: BigInt(salt.trim()),
      assetId: Number(assetId.trim()),
      amount: BigInt(amount.trim()),
    };
    if (!Number.isInteger(holding.assetId) || holding.assetId < 0 || holding.assetId >= NUM_ASSETS) {
      throw new Error(`assetId ${holding.assetId} is outside the price table`);
    }
    if (holding.amount < 0n || holding.amount > MAX_U64) {
      throw new Error(`amount ${holding.amount} does not fit in u64`);
    }
    return holding;
  });
}

const holdings = parseHoldingsCsv("./arms/zk-circuit/prover/customers.csv");
if (holdings.length > LEAF_CAPACITY) {
  throw new Error(`${holdings.length} holdings exceeds circuit capacity ${LEAF_CAPACITY}`);
}

const { pricesUsd } = JSON.parse(readFileSync("./arms/zk-circuit/prover/prices.json", "utf8"));
if (pricesUsd.length !== NUM_ASSETS) {
  throw new Error(`expected ${NUM_ASSETS} prices, got ${pricesUsd.length}`);
}

const padded: Holding[] = [...holdings];
while (padded.length < LEAF_CAPACITY) {
  padded.push({ username: "", salt: 0n, assetId: 0, amount: 0n });
}

const list = (values: (string | number | bigint)[]) => `[${values.map((v) => `"${v}"`).join(", ")}]`;
const proverToml = [
  `usernames = ${list(padded.map((h) => usernameToBigInt(h.username)))}`,
  `salts = ${list(padded.map((h) => h.salt))}`,
  `asset_ids = ${list(padded.map((h) => h.assetId))}`,
  `amounts = ${list(padded.map((h) => h.amount))}`,
  `prices = ${list(pricesUsd)}`,
  "",
].join("\n");

writeFileSync("./arms/zk-circuit/circuit/Prover.toml", proverToml);

const prices = pricesUsd.map(BigInt);
const { levels, root } = buildTree(padded, prices);

const expectedUsd = holdings.reduce((total, h) => total + h.amount * BigInt(pricesUsd[h.assetId]), 0n);
if (root.sum !== expectedUsd) throw new Error("TS tree total disagrees with the CSV");
console.log(`Wrote arms/zk-circuit/circuit/Prover.toml (${holdings.length} holdings, expect ${expectedUsd} USD)`);

mkdirSync("./demo-site/public/bundles", { recursive: true });
const byCustomer = new Map<string, number[]>();
padded.forEach((holding, index) => {
  if (!holding.username) return;
  byCustomer.set(holding.username, [...(byCustomer.get(holding.username) ?? []), index]);
});

for (const [username, indices] of byCustomer) {
  writeFileSync(
    `./demo-site/public/bundles/${username}.json`,
    serializeBundle({
      username,
      prices: pricesUsd,
      parts: indices.map((index) => createProof(index, padded, levels)),
    }),
  );
}
console.log(`Wrote demo-site/public/bundles/ (${byCustomer.size} customers)`);

mkdirSync("./demo-site/public/operator", { recursive: true });
writeFileSync(
  "./demo-site/public/operator/ledger.json",
  JSON.stringify(
    {
      prices: pricesUsd,
      rootHash: root.hash.toString(),
      totalUsd: root.sum.toString(),
      capacity: LEAF_CAPACITY,
      rows: holdings.map((h) => ({
        username: h.username,
        assetId: h.assetId,
        amount: h.amount.toString(),
        valueUsd: (h.amount * BigInt(pricesUsd[h.assetId])).toString(),
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log("Wrote demo-site/public/operator/ledger.json");
