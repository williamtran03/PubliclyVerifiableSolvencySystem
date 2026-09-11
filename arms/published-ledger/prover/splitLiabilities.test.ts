import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitLiabilities, verifyCustomer, verifyPublicLedger } from "./splitLiabilities.ts";
import { buildTree, keccakHash, verifyProof, serializeProof, deserializeProof } from "./tree.ts";
const snapshot = `0x${"01".repeat(32)}` as const;
const customers = [
  { customerId: "alice", name: "Alice Example", dateOfBirth: "2000-01-01", amounts: [40n, 60n] },
  { customerId: "bob", name: "Bob Example", dateOfBirth: "2001-02-03", amounts: [20n] },
];
function fixture() { return buildSplitLiabilities(customers, snapshot); }
test("split customer verifies full expected balance and public total", () => {
  const { ledger, bundles } = fixture();
  assert.equal(ledger.totalLiabilities, 120n);
  assert.ok(verifyPublicLedger(ledger));
  assert.ok(verifyCustomer(bundles[0], 100n, ledger));
  assert.ok(verifyCustomer(bundles[1], 20n, ledger));
  const p = bundles[0].parts[0].proof;
  assert.ok(verifyProof(deserializeProof(serializeProof(p)), keccakHash));
});
test("omitted part, duplicate part, wrong balance and stale snapshot fail", () => {
  const { ledger, bundles: [b] } = fixture();
  assert.equal(verifyCustomer({ ...b, parts: b.parts.slice(0, 1) }, 100n, ledger), false);
  assert.equal(verifyCustomer({ ...b, parts: [...b.parts, b.parts[0]] }, 140n, ledger), false);
  assert.equal(verifyCustomer(b, 101n, ledger), false);
  assert.equal(verifyCustomer(b, 100n, { ...ledger, snapshotId: `0x${"02".repeat(32)}` }), false);
});
test("tampered identity, salt, total, amount and path fail", () => {
  const { ledger, bundles: [b] } = fixture();
  assert.equal(verifyCustomer({ ...b, name: "Mallory" }, 100n, ledger), false);
  assert.equal(verifyCustomer(b, 100n, { ...ledger, totalLiabilities: 1n }), false);
  assert.equal(verifyPublicLedger({ ...ledger, totalLiabilities: 1n }), false);
  const p = b.parts[0].proof;
  assert.equal(verifyProof({ ...p, siblingSums: [] }, keccakHash), false);
  assert.equal(verifyProof({ ...p, pathIndices: p.pathIndices.map(() => 2) }, keccakHash), false);
  b.parts[0].salt = `0x${"00".repeat(32)}`;
  assert.equal(verifyCustomer(b, 100n, ledger), false);
});
test("negative, overflow and empty inputs fail; salts change commitments", () => {
  assert.throws(() => buildTree([{ username: "a", balance: -1n }], keccakHash));
  assert.throws(() => buildTree([{ username: "a", balance: (1n << 256n) - 1n }, { username: "b", balance: 1n }], keccakHash));
  assert.throws(() => buildTree([], keccakHash));
  assert.throws(() => buildSplitLiabilities([customers[0], customers[0]], snapshot));
  assert.notEqual(fixture().ledger.rootHash, fixture().ledger.rootHash);
});

