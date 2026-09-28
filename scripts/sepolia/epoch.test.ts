import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerBalances, settleStaging } from "./epoch.ts";
import { bindRoot, buildTree, createBundle, parseHoldingsCsv, verifyBundle } from "../../arms/zk-circuit/prover/multiAssetTree.ts";
import { customerSecretCommitment } from "../../shared/merkleSumTree.ts";

test("publication checks sum repeated customer holdings in each asset", () => {
  const aliceSecret = (1n << 200n) + 1n;
  const bobSecret = (1n << 201n) + 2n;
  const aliceCommitment = customerSecretCommitment(aliceSecret);
  const holdings = parseHoldingsCsv(`username,secretCommitment,assetId,amount\nalice,${aliceCommitment},0,2\nalice,${aliceCommitment},0,3\nalice,${aliceCommitment},1,7\nbob,${customerSecretCommitment(bobSecret)},0,11`);
  const tree = buildTree(holdings);
  const root = bindRoot(tree.treeRoot, 7n);
  const bundle = createBundle("alice", tree.holdings, tree.levels);
  const expectedAmounts = customerBalances(holdings.filter(h => h.username === "alice"));
  assert.deepEqual([...expectedAmounts], [[0, 5n], [1, 7n]]);
  assert.ok(verifyBundle(bundle, { username: "alice", secret: aliceSecret, expectedAmounts }, root, 7n));
  expectedAmounts.set(0, 3n);
  assert.equal(verifyBundle(bundle, { username: "alice", secret: aliceSecret, expectedAmounts }, root, 7n), false);
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
