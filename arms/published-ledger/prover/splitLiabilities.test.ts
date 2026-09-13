import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitLiabilities, verifyCustomer, verifyPublicLedger, type Customer } from "./splitLiabilities.ts";
import { buildTree, keccakHash, verifyProof, serializeProof, deserializeProof } from "./tree.ts";
const snapshot = `0x${"01".repeat(32)}` as const;
const customers: Customer[] = [
  { customerId: "alice", name: "Alice Example", dateOfBirth: "2000-01-01", parts: [{ assetId: 0, amount: 40n }, { assetId: 0, amount: 60n }, { assetId: 1, amount: 3n }] },
  { customerId: "bob", name: "Bob Example", dateOfBirth: "2001-02-03", parts: [{ assetId: 0, amount: 20n }] },
];
const alice = new Map([[0, 100n], [1, 3n]]);
function fixture() { return buildSplitLiabilities(customers, snapshot, 3); }
test("each asset gets its own tree and total; customers verify per asset", () => {
  const { ledger, bundles } = fixture();
  assert.deepEqual(ledger.assets.map((a) => a.totalLiabilities), [120n, 3n, 0n]);
  assert.equal(ledger.assets[2].rootHash, 0n, "an asset nobody holds has an empty ledger");
  assert.ok(verifyPublicLedger(ledger));
  assert.ok(verifyCustomer(bundles[0], alice, ledger));
  assert.ok(verifyCustomer(bundles[1], new Map([[0, 20n]]), ledger));
  const p = bundles[0].parts[0].proof;
  assert.ok(verifyProof(deserializeProof(serializeProof(p)), keccakHash));
});
test("omitted part, omitted asset, duplicate part, wrong balance and stale snapshot fail", () => {
  const { ledger, bundles: [b] } = fixture();
  assert.equal(verifyCustomer({ ...b, parts: b.parts.slice(0, 1) }, alice, ledger), false);
  assert.equal(verifyCustomer({ ...b, parts: b.parts.slice(0, 2) }, alice, ledger), false);
  assert.equal(verifyCustomer({ ...b, parts: [...b.parts, b.parts[0]] }, new Map([[0, 140n], [1, 3n]]), ledger), false);
  assert.equal(verifyCustomer(b, new Map([[0, 101n], [1, 3n]]), ledger), false);
  assert.equal(verifyCustomer(b, new Map([[0, 100n]]), ledger), false);
  assert.equal(verifyCustomer(b, alice, { ...ledger, snapshotId: `0x${"02".repeat(32)}` }), false);
});
test("a part moved to another asset's tree fails", () => {
  const { ledger, bundles: [b] } = fixture();
  const moved = { ...b, parts: b.parts.map((p, i) => (i === 2 ? { ...p, assetId: 0 } : p)) };
  assert.equal(verifyCustomer(moved, new Map([[0, 103n]]), ledger), false);
});
test("tampered identity, salt, total, amount and path fail", () => {
  const { ledger, bundles: [b] } = fixture();
  assert.equal(verifyCustomer({ ...b, name: "Mallory" }, alice, ledger), false);
  const lowered = { ...ledger, assets: ledger.assets.map((a, i) => (i === 0 ? { ...a, totalLiabilities: 1n } : a)) };
  assert.equal(verifyCustomer(b, alice, lowered), false);
  assert.equal(verifyPublicLedger(lowered), false);
  const p = b.parts[0].proof;
  assert.equal(verifyProof({ ...p, siblingSums: [] }, keccakHash), false);
  assert.equal(verifyProof({ ...p, pathIndices: p.pathIndices.map(() => 2) }, keccakHash), false);
  b.parts[0].salt = `0x${"00".repeat(32)}`;
  assert.equal(verifyCustomer(b, alice, ledger), false);
});
test("negative, overflow, empty and unknown-asset inputs fail; salts change commitments", () => {
  assert.throws(() => buildTree([{ username: "a", balance: -1n }], keccakHash));
  assert.throws(() => buildTree([{ username: "a", balance: (1n << 256n) - 1n }, { username: "b", balance: 1n }], keccakHash));
  assert.throws(() => buildTree([], keccakHash));
  assert.throws(() => buildSplitLiabilities([customers[0], customers[0]], snapshot, 3));
  assert.throws(() => buildSplitLiabilities(customers, snapshot, 1), /not in the registry/);
  assert.notEqual(fixture().ledger.assets[0].rootHash, fixture().ledger.assets[0].rootHash);
});
