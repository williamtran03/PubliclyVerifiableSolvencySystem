import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BALANCE } from "./field.ts";
import { keccakHash, poseidonHash, usernameToField } from "./hash.ts";
import {
  buildTree,
  createProof,
  deserializeProof,
  findLeafIndex,
  serializeProof,
  toLeaves,
  verifyProof,
  type Entry,
} from "./merkleSumTree.ts";

const entries: Entry[] = [
  { username: "customer-123", balance: 12550n },
  { username: "customer-456", balance: 5000n },
  { username: "customer-789", balance: 32000n },
];
const total = 49550n;

test("root sum equals the total of all balances", () => {
  const { root } = buildTree(entries, poseidonHash);
  assert.equal(root.sum, total);
});

test("every customer gets a valid inclusion proof", () => {
  const tree = buildTree(entries, poseidonHash);
  for (const entry of entries) {
    const proof = createProof(findLeafIndex(tree, entry.username), tree);
    assert.equal(proof.rootHash, tree.root.hash);
    assert.equal(proof.balance, entry.balance);
    assert.ok(verifyProof(proof, poseidonHash));
  }
});

test("a tampered balance fails verification", () => {
  const tree = buildTree(entries, poseidonHash);
  const proof = createProof(findLeafIndex(tree, "customer-123"), tree);
  assert.equal(
    verifyProof({ ...proof, balance: proof.balance + 1n }, poseidonHash),
    false,
    "raising your own balance must not verify",
  );
  assert.equal(
    verifyProof({ ...proof, rootSum: proof.rootSum - 1n }, poseidonHash),
    false,
    "shrinking the claimed total must not verify",
  );
  assert.equal(
    verifyProof({ ...proof, siblingSums: [0n, ...proof.siblingSums.slice(1)] }, poseidonHash),
    false,
    "shrinking a sibling's sum must not verify",
  );
});

test("a proof whose username does not match its id is rejected", () => {
  const tree = buildTree(entries, poseidonHash);
  const proof = createProof(findLeafIndex(tree, "customer-123"), tree);
  assert.equal(verifyProof({ ...proof, username: "customer-456" }, poseidonHash), false);
});

test("the tree pads a non-power-of-two customer list with zero-balance leaves", () => {
  const five = [
    ...entries,
    { username: "customer-abc", balance: 100n },
    { username: "customer-def", balance: 200n },
  ];
  const tree = buildTree(five, poseidonHash);
  assert.equal(tree.leaves.length, 8);
  assert.equal(tree.root.sum, total + 300n);
  assert.equal(tree.leaves.filter((leaf) => leaf.username === null).length, 3);
  assert.ok(tree.leaves.every((leaf) => leaf.username !== null || leaf.balance === 0n));
});

test("leaves come out strictly increasing in id, padding included", () => {
  const tree = buildTree(entries, poseidonHash);
  for (let i = 1; i < tree.leaves.length; i++) {
    assert.ok(
      tree.leaves[i - 1].id < tree.leaves[i].id,
      `leaf ${i} is not greater than leaf ${i - 1}`,
    );
  }
});

test("duplicate customers are rejected instead of being silently merged", () => {
  assert.throws(
    () => toLeaves([...entries, { username: "customer-123", balance: 1n }]),
    /duplicate username/,
  );
});

test("out-of-range balances are rejected", () => {
  assert.throws(() => toLeaves([{ username: "a", balance: -1n }]), /negative balance/);
  assert.throws(() => toLeaves([{ username: "a", balance: MAX_BALANCE + 1n }]), /exceeds 128 bits/);
});

test("usernames longer than 32 bytes stay distinct", () => {
  // A raw byte-to-integer encoding wraps here and hands both customers the same
  // leaf; hashing keeps them apart.
  const long = "customer-" + "x".repeat(40);
  assert.notEqual(usernameToField(long + "1"), usernameToField(long + "2"));
});

test("proofs survive a JSON round trip", () => {
  const tree = buildTree(entries, poseidonHash);
  const proof = createProof(findLeafIndex(tree, "customer-789"), tree);
  const restored = deserializeProof(serializeProof(proof));
  assert.deepEqual(restored, proof);
  assert.ok(verifyProof(restored, poseidonHash));
});

test("the hash function is swappable end to end", () => {
  const poseidonTree = buildTree(entries, poseidonHash);
  const keccakTree = buildTree(entries, keccakHash);
  assert.equal(poseidonTree.root.sum, keccakTree.root.sum);
  assert.notEqual(poseidonTree.root.hash, keccakTree.root.hash);

  const proof = createProof(findLeafIndex(keccakTree, "customer-123"), keccakTree);
  assert.ok(verifyProof(proof, keccakHash));
  assert.equal(verifyProof(proof, poseidonHash), false, "a proof must not verify under both hashes");
});

test("a single customer still produces a tree", () => {
  const tree = buildTree([{ username: "only", balance: 7n }], poseidonHash);
  assert.equal(tree.leaves.length, 2);
  assert.equal(tree.root.sum, 7n);
  assert.ok(verifyProof(createProof(findLeafIndex(tree, "only"), tree), poseidonHash));
});

test("padding leaves cannot be turned into proofs", () => {
  const tree = buildTree(entries, poseidonHash);
  const padIndex = tree.leaves.findIndex((leaf) => leaf.username === null);
  assert.throws(() => createProof(padIndex, tree), /padding/);
});
