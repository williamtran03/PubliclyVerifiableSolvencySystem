import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTree,
  createProof,
  verifyProof,
  poseidon2Hash,
  usernameToBigInt,
  type Entry,
} from "./merkleSumTree.ts";

const entries: Entry[] = [
  { username: "customer-123", balance: 12550n, salt: 111n },
  { username: "customer-456", balance: 5000n, salt: 222n },
  { username: "customer-789", balance: 32000n, salt: 333n },
];

test("root sum equals the total of all balances", () => {
  const { root } = buildTree(entries, poseidon2Hash);
  assert.equal(root.sum, 49550n);
});

test("every real entry produces a valid inclusion proof", () => {
  const { levels, root, entries: padded } = buildTree(entries, poseidon2Hash);
  for (let i = 0; i < entries.length; i++) {
    const proof = createProof(i, padded, levels);
    assert.equal(proof.rootHash, root.hash);
    assert.ok(verifyProof(proof, poseidon2Hash));
  }
});

test("a tampered balance fails verification", () => {
  const { levels, entries: padded } = buildTree(entries, poseidon2Hash);
  const proof = createProof(0, padded, levels);
  const tampered = { ...proof, entry: { ...proof.entry, balance: proof.entry.balance + 1n } };
  assert.equal(verifyProof(tampered, poseidon2Hash), false);
});

test("a non-power-of-two entry count still pads and sums correctly", () => {
  const five: Entry[] = [
    ...entries,
    { username: "customer-A", balance: 100n, salt: 444n },
    { username: "customer-B", balance: 200n, salt: 555n },
  ];
  const { root } = buildTree(five, poseidon2Hash);
  assert.equal(root.sum, 49550n + 100n + 200n);
});

test("an index outside the tree is rejected before a proof is built", () => {
  const { levels, entries: padded } = buildTree(entries, poseidon2Hash);
  assert.throws(() => createProof(padded.length, padded, levels), /outside the tree/);
  assert.throws(() => createProof(-1, padded, levels), /outside the tree/);
});

test("a malformed proof returns false instead of throwing", () => {
  const { levels, entries: padded } = buildTree(entries, poseidon2Hash);
  const proof = createProof(0, padded, levels);

  const shortSums = { ...proof, siblingSums: proof.siblingSums.slice(1) };
  assert.equal(verifyProof(shortSums, poseidon2Hash), false);

  const badDirection = { ...proof, pathIndices: [2, ...proof.pathIndices.slice(1)] };
  assert.equal(verifyProof(badDirection, poseidon2Hash), false);

  const negativeBalance = { ...proof, entry: { ...proof.entry, balance: -1n } };
  assert.equal(verifyProof(negativeBalance, poseidon2Hash), false);
});

test("usernames that would wrap the field are rejected", () => {
  const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  assert.ok(usernameToBigInt("x".repeat(31)) < p);
  assert.throws(() => usernameToBigInt("x".repeat(32)), /at most 31/);
  assert.throws(() => usernameToBigInt("é".repeat(16)), /at most 31/);

  const { levels, entries: padded } = buildTree(entries, poseidon2Hash);
  const proof = createProof(0, padded, levels);
  const long = { ...proof, entry: { ...proof.entry, username: "x".repeat(40) } };
  assert.equal(verifyProof(long, poseidon2Hash), false);
});
