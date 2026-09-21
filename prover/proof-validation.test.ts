import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, createProof, verifyProof, type MerkleSumProof } from "./merkleSumTree.ts";
import { poseidonHash } from "./hash.ts";
import { BN254_FR } from "./field.ts";

test("rejects malformed paths and field aliases without throwing", () => {
  const tree = buildTree([{ username: "alice", balance: 10n }, { username: "bob", balance: 20n }], poseidonHash);
  const proof = createProof(0, tree);
  assert.equal(verifyProof(proof, poseidonHash), true);
  assert.equal(verifyProof({ ...proof, pathIndices: [2] }, poseidonHash), false);
  assert.equal(verifyProof({ ...proof, siblingHashes: proof.siblingHashes.map(n => n + BN254_FR) }, poseidonHash), false);
  assert.equal(verifyProof({ ...proof, siblingSums: [-1n] }, poseidonHash), false);
  assert.equal(verifyProof({} as MerkleSumProof, poseidonHash), false);
});
