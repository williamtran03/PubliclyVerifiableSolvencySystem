import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTree,
  createProof,
  verifyProof,
  verifyBundle,
  serializeBundle,
  deserializeBundle,
  type Holding,
} from "./multiAssetTree.ts";

const holdings: Holding[] = [
  { username: "customer-123", salt: 84731920475619283746152039485761029384n, assetId: 0, amount: 2n },
  { username: "customer-456", salt: 19283746501928374650192837465019283746n, assetId: 1, amount: 10n },
  { username: "customer-789", salt: 55018273645019283746501928374650192837n, assetId: 2, amount: 5000n },
];
const prices = [60000n, 3000n, 1n];

// Locks the TS mirror to arms/zk-circuit/circuit/src/main.nr. If either side changes
// its hashing or valuation, this fails instead of silently producing two roots.
const CIRCUIT_ROOT = 0x081b46cea7fb102bf48512d1d816ab14f3e95a0734b37c5777afc882186ddafdn;

test("root and total match the Noir circuit exactly", () => {
  const { root } = buildTree(holdings, prices);
  assert.equal(root.hash, CIRCUIT_ROOT);
  assert.equal(root.sum, 155000n);
});

test("valuing the same holdings at a different price table changes root and total", () => {
  const { root } = buildTree(holdings, [30000n, 3000n, 1n]);
  assert.notEqual(root.hash, CIRCUIT_ROOT);
  assert.equal(root.sum, 95000n);
});

test("every holding produces a verifying inclusion proof", () => {
  const { levels, root, holdings: padded } = buildTree(holdings, prices);
  for (let i = 0; i < holdings.length; i++) {
    const proof = createProof(i, padded, levels);
    assert.equal(proof.rootHash, root.hash);
    assert.ok(verifyProof(proof, prices));
  }
});

test("a tampered amount fails verification", () => {
  const { levels, holdings: padded } = buildTree(holdings, prices);
  const proof = createProof(0, padded, levels);
  const tampered = { ...proof, holding: { ...proof.holding, amount: proof.holding.amount + 1n } };
  assert.equal(verifyProof(tampered, prices), false);
});

test("a proof verified against the wrong price table fails", () => {
  const { levels, holdings: padded } = buildTree(holdings, prices);
  const proof = createProof(0, padded, levels);
  assert.equal(verifyProof(proof, [30000n, 3000n, 1n]), false);
});

test("a customer bundle round-trips and checks against expected amounts", () => {
  const { levels, root, holdings: padded } = buildTree(holdings, prices);
  const bundle = {
    username: "customer-456",
    prices: prices.map(String),
    parts: [createProof(1, padded, levels)],
  };

  const restored = deserializeBundle(serializeBundle(bundle));
  const expected = new Map([[1, 10n]]);
  assert.ok(verifyBundle(restored, expected, root.hash, root.sum));

  const wrong = new Map([[1, 11n]]);
  assert.equal(verifyBundle(restored, wrong, root.hash, root.sum), false);
});

test("a bundle claiming someone else's leaf is rejected", () => {
  const { levels, root, holdings: padded } = buildTree(holdings, prices);
  const bundle = {
    username: "customer-456",
    prices: prices.map(String),
    parts: [createProof(0, padded, levels)],
  };
  assert.equal(verifyBundle(bundle, new Map([[0, 2n]]), root.hash, root.sum), false);
});

test("one leaf cannot be counted twice by giving it a second path encoding", () => {
  const { levels, root, holdings: padded } = buildTree(holdings, prices);
  const part = createProof(0, padded, levels);
  const alias = { ...part, pathIndices: [2, ...part.pathIndices.slice(1)] };
  const bundle = { username: "customer-123", prices: prices.map(String), parts: [part, alias] };

  // customer-123 really holds one 2 BTC leaf; claiming 4 BTC must fail
  assert.equal(verifyBundle(bundle, new Map([[0, 4n]]), root.hash, root.sum), false);
  assert.equal(verifyProof(alias, prices), false);
});

test("a proof with the wrong number of levels is rejected", () => {
  const { levels, holdings: padded } = buildTree(holdings, prices);
  const proof = createProof(0, padded, levels);
  const short = {
    ...proof,
    siblingHashes: proof.siblingHashes.slice(1),
    siblingSums: proof.siblingSums.slice(1),
    pathIndices: proof.pathIndices.slice(1),
  };
  assert.equal(verifyProof(short, prices), false);
});
