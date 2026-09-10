import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitLiabilities } from "./splitLiabilities.ts";
import { deserializeSplitBundle, verifySplitBundle, MAX_BALANCE } from "./splitProof.ts";
import { poseidon2Hash, verifyProof } from "../merkleSumTree.ts";
const id = `0x${"01".repeat(32)}` as const;
const customers = [{ customerId: "alice", name: "Alice Example", dateOfBirth: "2000-01-01", amounts: [40n, 60n] }, { customerId: "bob", name: "Bob Example", dateOfBirth: "2001-01-01", amounts: [20n] }];
const fixture = () => buildSplitLiabilities(customers, id);
test("split parts use main's salted leaf format and sum to the expected full balance", () => {
  const { epoch, bundles, witness } = fixture();
  assert.equal(epoch.totalLiabilities, 120n); assert.equal(witness.balances.length, 8);
  for (const b of bundles) for (const p of b.parts) assert.ok(verifyProof(p.proof, poseidon2Hash));
  assert.ok(verifySplitBundle(bundles[0], "alice", 100n, epoch.rootHash, 120n));
  assert.ok(verifySplitBundle(bundles[1], "bob", 20n, epoch.rootHash, 120n));
  const b = deserializeSplitBundle(JSON.stringify(bundles[0], (_, v) => typeof v === "bigint" ? v.toString() : v));
  assert.ok(verifySplitBundle(b, "alice", 100n, epoch.rootHash, 120n));
});
test("split bundle rejects omitted, duplicated, tampered and stale parts", () => {
  const { epoch, bundles: [b] } = fixture();
  const check = (bundle: typeof b) => verifySplitBundle(bundle, "alice", 100n, epoch.rootHash, 120n);
  assert.equal(check({ ...b, parts: b.parts.slice(0, 1) }), false);
  assert.equal(check({ ...b, parts: [b.parts[0], b.parts[0]] }), false);
  assert.equal(check({ ...b, name: "Mallory" }), false);
  assert.equal(check({ ...b, snapshotId: `0x${"02".repeat(32)}` }), false);
  assert.equal(verifySplitBundle(b, "alice", 100n, epoch.rootHash, 1n), false);
  assert.equal(verifySplitBundle(b, "alice", 101n, epoch.rootHash, 120n), false);
});
test("split builder rejects invalid amounts, duplicate customers and circuit overflow", () => {
  assert.throws(() => buildSplitLiabilities([], id));
  assert.throws(() => buildSplitLiabilities([customers[0], customers[0]], id));
  for (const amounts of [[-1n], [MAX_BALANCE + 1n], Array(9).fill(1n)]) assert.throws(() => buildSplitLiabilities([{ ...customers[0], amounts }], id));
  assert.notEqual(fixture().epoch.rootHash, fixture().epoch.rootHash);
});
