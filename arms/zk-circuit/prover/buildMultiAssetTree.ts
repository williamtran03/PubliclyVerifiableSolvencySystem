import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodePacked, keccak256, type Hex } from "viem";
import { usernameToBigInt, LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";
import {
  bindRoot,
  buildTree,
  createBundle,
  liabilitiesOf,
  parseHoldingsCsv,
  serializeBundle,
  FIELD_ORDER,
  MAX_U64,
  NUM_ASSETS,
  type Holding,
} from "./multiAssetTree.ts";
import type { Snapshot } from "./fetchSnapshot.ts";

const DEMO_SEED: Hex = keccak256(encodePacked(["string"], ["northwind demo tree seed"]));

function draw(seed: Hex, label: string, i: number): bigint {
  return BigInt(keccak256(encodePacked(["bytes32", "string", "uint256"], [seed, label, BigInt(i)])));
}

export function arrangeLeaves(holdings: Holding[], seed: Hex): Holding[] {
  if (holdings.length > LEAF_CAPACITY) {
    throw new Error(`${holdings.length} holdings exceeds circuit capacity ${LEAF_CAPACITY}`);
  }
  const leaves = [...holdings];
  for (let i = holdings.length; i < LEAF_CAPACITY; i++) {
    leaves.push({ username: "", salt: draw(seed, "padding", i) % FIELD_ORDER, assetId: 0, amount: 0n });
  }
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Number(draw(seed, "shuffle", i) % BigInt(i + 1));
    [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
  }
  return leaves;
}

export function prepareEpoch(holdings: Holding[], snapshot: Snapshot, seed: Hex) {
  const floors = snapshot.reserveUnits.map((units) => (units > MAX_U64 ? MAX_U64 : units));
  const liabilities = liabilitiesOf(holdings);
  for (let i = 0; i < NUM_ASSETS; i++) {
    if (liabilities[i] > floors[i]) {
      throw new Error(`asset ${i}: liabilities ${liabilities[i]} exceed reserves ${floors[i]}; the proof cannot exist`);
    }
  }

  const leaves = arrangeLeaves(holdings, seed);
  const { levels, treeRoot, holdings: padded } = buildTree(leaves);
  const rootHash = bindRoot(treeRoot, snapshot.context);

  const list = (values: (string | number | bigint)[]) => `[${values.map((v) => `"${v}"`).join(", ")}]`;
  const proverToml = [
    `usernames = ${list(padded.map((h) => usernameToBigInt(h.username)))}`,
    `salts = ${list(padded.map((h) => h.salt))}`,
    `asset_ids = ${list(padded.map((h) => h.assetId))}`,
    `amounts = ${list(padded.map((h) => h.amount))}`,
    `reserve_floors = ${list(floors)}`,
    `context = "${snapshot.context}"`,
    "",
  ].join("\n");

  return { padded, levels, rootHash, floors, liabilities, proverToml };
}

export function readSnapshot(path: string): Snapshot {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    registry: raw.registry,
    chainId: BigInt(raw.chainId),
    epochId: BigInt(raw.epochId),
    context: BigInt(raw.context),
    reserveUnits: raw.reserveUnits.map(BigInt),
    pricesUsd: raw.pricesUsd.map(BigInt),
    roundIds: raw.roundIds.map(BigInt),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const holdings = parseHoldingsCsv(readFileSync("./arms/zk-circuit/prover/customers.csv", "utf8"));
  const snapshot = readSnapshot("./arms/zk-circuit/prover/snapshot.json");
  const seed = (process.env.TREE_SEED as Hex | undefined) ?? DEMO_SEED;
  if (!process.env.TREE_SEED) console.log("Using the public demo seed; set TREE_SEED for real data.");

  const epoch = prepareEpoch(holdings, snapshot, seed);
  writeFileSync("./arms/zk-circuit/circuit/Prover.toml", epoch.proverToml);
  console.log(
    `Wrote arms/zk-circuit/circuit/Prover.toml (${holdings.length} holdings, ` +
      `liabilities ${epoch.liabilities.join("/")} under floors ${epoch.floors.join("/")})`,
  );

  const outputDir = "./arms/zk-circuit/fixtures/generated";
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  for (const username of new Set(holdings.map((h) => h.username))) {
    writeFileSync(
      `${outputDir}/${username}.json`,
      serializeBundle(createBundle(username, epoch.padded, epoch.levels)),
      { mode: 0o600 },
    );
  }
  console.log(`Wrote private customer bundles to ${outputDir}/`);

  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    `${outputDir}/ledger.json`,
    JSON.stringify(
      {
        rootHash: epoch.rootHash.toString(),
        epochId: snapshot.epochId.toString(),
        capacity: LEAF_CAPACITY,
        liabilities: epoch.liabilities.map(String),
        floors: epoch.floors.map(String),
        pricesUsd: snapshot.pricesUsd.map(String),
        rows: holdings.map((h) => ({ username: h.username, assetId: h.assetId, amount: h.amount.toString() })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote private operator ledger to ${outputDir}/ledger.json`);
}
