import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerBalances, settleStaging } from "./epoch.ts";
import { bindRoot, buildTree, createBundle, parseHoldingsCsv, verifyBundle } from "../../arms/zk-circuit/prover/multiAssetTree.ts";

test("publication checks sum repeated customer holdings in each asset", () => {
  const holdings = parseHoldingsCsv("username,salt,assetId,amount\nalice,1,0,2\nalice,1,0,3\nalice,1,1,7\nbob,2,0,11");
  const tree = buildTree(holdings);
  const root = bindRoot(tree.treeRoot, 7n);
  const bundle = createBundle("alice", tree.holdings, tree.levels);
  const expectedAmounts = customerBalances(holdings.filter(h => h.username === "alice"));
  assert.deepEqual([...expectedAmounts], [[0, 5n], [1, 7n]]);
  assert.ok(verifyBundle(bundle, { username: "alice", salt: 1n, expectedAmounts }, root, 7n));
  expectedAmounts.set(0, 3n);
  assert.equal(verifyBundle(bundle, { username: "alice", salt: 1n, expectedAmounts }, root, 7n), false);
});

test("keeps staged bundles of published epochs and drops those of unpublished ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "sepolia-bundles-"));
  const previous = process.env.PRIVATE_OUTPUT;
  process.env.PRIVATE_OUTPUT = directory;
  try {
    const arm = join(directory, "snarkless");
    for (const name of ["epoch-0", "epoch-1.pending", "epoch-2.pending"]) {
      mkdirSync(join(arm, name), { recursive: true });
      writeFileSync(join(arm, name, "customer-123.json"), name);
    }
    settleStaging("snarkless", 2n);
    assert.deepEqual(readdirSync(arm).sort(), ["epoch-0", "epoch-1"]);
    assert.equal(readFileSync(join(arm, "epoch-1", "customer-123.json"), "utf8"), "epoch-1.pending");

    mkdirSync(join(arm, "epoch-1.pending"));
    assert.throws(() => settleStaging("snarkless", 2n), /both .* exist/);
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_OUTPUT;
    else process.env.PRIVATE_OUTPUT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
