import { readFileSync, writeFileSync } from "node:fs";
import { usernameToBigInt, LEAF_CAPACITY } from "./merkleSumTree.ts";

const NUM_ASSETS = 3;
const MAX_U64 = (1n << 64n) - 1n;

type Holding = { username: string; salt: bigint; assetId: number; amount: bigint };

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

const holdings = parseHoldingsCsv("./prover/customers-multiasset.csv");
if (holdings.length > LEAF_CAPACITY) {
  throw new Error(`${holdings.length} holdings exceeds circuit capacity ${LEAF_CAPACITY}`);
}

const { pricesUsd } = JSON.parse(readFileSync("./prover/prices.json", "utf8"));
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

writeFileSync("./circuit-multiasset/Prover.toml", proverToml);

const expectedUsd = holdings.reduce((total, h) => total + h.amount * BigInt(pricesUsd[h.assetId]), 0n);
console.log(`Wrote circuit-multiasset/Prover.toml (${holdings.length} holdings, expect ${expectedUsd} USD)`);
