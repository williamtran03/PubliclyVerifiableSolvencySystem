import test from "node:test";
import assert from "node:assert/strict";
import { buildTree, keccakHash } from "../../../arms/published-ledger/prover/tree.ts";
import { inspectArtifact } from "./company.ts";
import type { Snapshot } from "../types.ts";

test("company audit recomputes the public ledger, then rejects changed balances", () => {
  const entries = [{ identityHash: 123n, balance: 25n, username: "" }, { identityHash: 456n, balance: 10n, username: "" }];
  const root = buildTree(entries, keccakHash).root;
  const snapshot: Snapshot = {
    epoch: 0n, timestamp: 1n, commitment: `0x${"ab".repeat(32)}`,
    assets: [{ label: "Asset 0", reserves: 40n, liabilities: root.sum }],
    data: { snapshotId: `0x${"ab".repeat(32)}`, roots: [root.hash], liabilities: [root.sum] },
  };
  const artifact = { snapshotId: snapshot.commitment, assets: [{ rootHash: root.hash.toString(), totalLiabilities: root.sum.toString(), entries: entries.map((entry) => ({ identityHash: entry.identityHash.toString(), balance: entry.balance.toString() })) }] };
  assert.match(inspectArtifact("published-ledger", snapshot, JSON.stringify(artifact)), /Roots/);
  artifact.assets[0].entries[0].balance = "26";
  assert.throws(() => inspectArtifact("published-ledger", snapshot, JSON.stringify(artifact)), /stimmt nicht/);
});

test("company ZK artifact must match root, context and every floor", () => {
  const snapshot: Snapshot = { epoch: 2n, timestamp: 1n, commitment: "0x7", assets: [{ label: "BTC", reserves: 100n, floor: 90n }], data: { root: 7n, context: 8n } };
  assert.match(inspectArtifact("zk-circuit", snapshot, JSON.stringify({ rootHash: "7", context: "8", floors: ["90"] })), /stimmen/);
  assert.throws(() => inspectArtifact("zk-circuit", snapshot, JSON.stringify({ rootHash: "7", context: "8", floors: ["91"] })), /nicht/);
});
