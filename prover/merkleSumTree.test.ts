import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, createProof, verifyProof, keccakHash, type Entry } from "./merkleSumTree.ts";

const entries: Entry[] = [
  { username: "customer-123", balance: 12550n },
  { username: "customer-456", balance: 5000n },
  { username: "customer-789", balance: 32000n },
];

test("root sum equals the total of all balances", () => {
  const { root } = buildTree(entries, keccakHash);
  assert.equal(root.sum, 49550n);
});

test("every real entry produces a valid inclusion proof", () => {
  const { levels, root, entries: padded } = buildTree(entries, keccakHash);
  for (let i = 0; i < entries.length; i++) {
    const proof = createProof(i, padded, levels);
    assert.equal(proof.rootHash, root.hash);
    assert.ok(verifyProof(proof, keccakHash));
  }
});

test("a tampered balance fails verification", () => {
  const { levels, entries: padded } = buildTree(entries, keccakHash);
  const proof = createProof(0, padded, levels);
  const tampered = { ...proof, entry: { ...proof.entry, balance: proof.entry.balance + 1n } };
  assert.equal(verifyProof(tampered, keccakHash), false);
});

test("a non-power-of-two entry count still pads and sums correctly", () => {
  const five: Entry[] = [
    ...entries,
    { username: "customer-A", balance: 100n },
    { username: "customer-B", balance: 200n },
  ];
  const { root } = buildTree(five, keccakHash);
  assert.equal(root.sum, 49550n + 100n + 200n);
});
