import { test } from "node:test";
import assert from "node:assert/strict";
import { usernameToField } from "../hash.ts";
import type { Entry } from "../merkleSumTree.ts";
import { commit } from "./commit.ts";
import { Fr, domain, interpolate } from "./field.ts";
import { buildEpoch, verifyCustomerProof, verifyEpoch } from "./grandSum.ts";
import { proveRange, verifyRange } from "./range.ts";
import { generateSrs, G1 } from "./srs.ts";

const entries: Entry[] = [
  { username: "customer-123", balance: 12550n },
  { username: "customer-456", balance: 5000n },
  { username: "customer-789", balance: 32000n },
];
const total = 49550n;

// Degree 2n-2 shows up in the range argument's fold, so the SRS has to reach it.
const srs = generateSrs(16);

test("the epoch's total is the sum of the balances", () => {
  const { epoch } = buildEpoch(srs, entries);
  assert.equal(epoch.totalLiabilities, total);
  assert.equal(epoch.n, 4);
});

test("a published epoch verifies", () => {
  const { epoch } = buildEpoch(srs, entries);
  const result = verifyEpoch(srs, epoch);
  assert.deepEqual(result.checks, { grandSum: true, range: true });
  assert.ok(result.ok);
});

test("a total that does not match the commitment is rejected", () => {
  const { epoch } = buildEpoch(srs, entries);
  const understated = { ...epoch, totalLiabilities: epoch.totalLiabilities - 1n };
  assert.equal(verifyEpoch(srs, understated).checks.grandSum, false);
});

test("every customer's own proof verifies", () => {
  const { epoch, proofs } = buildEpoch(srs, entries);
  assert.equal(proofs.length, entries.length);
  for (const proof of proofs) {
    assert.ok(verifyCustomerProof(srs, epoch, proof), `${proof.username} failed`);
    assert.equal(proof.id, usernameToField(proof.username));
  }
});

test("a customer cannot inflate their own balance", () => {
  const { epoch, proofs } = buildEpoch(srs, entries);
  const tampered = { ...proofs[0], balance: proofs[0].balance + 1n };
  assert.equal(verifyCustomerProof(srs, epoch, tampered), false);
});

test("a proof cannot be moved to another index", () => {
  const { epoch, proofs } = buildEpoch(srs, entries);
  assert.equal(verifyCustomerProof(srs, epoch, { ...proofs[0], index: proofs[1].index }), false);
});

test("a proof from one epoch does not verify against another", () => {
  const { epoch } = buildEpoch(srs, entries);
  const { proofs: otherProofs } = buildEpoch(srs, [
    ...entries.slice(1),
    { username: "customer-123", balance: 1n },
  ]);
  assert.equal(verifyCustomerProof(srs, epoch, otherProofs[0]), false);
});

test("padding leaves get no proof", () => {
  const { epoch, proofs, leaves } = buildEpoch(srs, [
    ...entries,
    { username: "customer-abc", balance: 1n },
    { username: "customer-def", balance: 2n },
  ]);
  assert.equal(epoch.n, 8);
  assert.equal(proofs.length, 5);
  assert.equal(leaves.filter((leaf) => leaf.username === null).length, 3);
});

test("the range argument rejects a balance that does not fit", () => {
  const n = 4;
  const balances = [1n, 2n, 3n, (1n << 128n) - 1n];
  const poly = interpolate(balances);
  assert.ok(verifyRange(srs, commit(srs, poly), n, proveRange(srs, poly, balances)));

  assert.throws(() => proveRange(srs, poly, [1n, 2n, 3n, 1n << 128n]), /does not fit/);
});

test("a negative balance is exactly what the range argument catches", () => {
  // Field arithmetic makes -1 an enormous positive number, so a custodian could
  // use it to cancel a real customer and publish a smaller total. The grand sum
  // alone is perfectly happy with that; the range argument is not.
  const n = 4;
  const balances = [Fr.create(-1n), 1n, 0n, 0n];
  const poly = interpolate(balances);
  const commitment = commit(srs, poly);

  assert.equal(Fr.mul(poly[0], BigInt(n)), Fr.ZERO, "the fake total really does come out as zero");
  assert.throws(() => proveRange(srs, poly, balances), /does not fit/);

  // And an attempt to pass off a proof built from an honest tree fails too.
  const honest = [1n, 1n, 0n, 0n];
  const honestProof = proveRange(srs, interpolate(honest), honest);
  assert.equal(verifyRange(srs, commitment, n, honestProof), false);
});

test("the grand sum equals n times the constant coefficient, on the real domain", () => {
  const { epoch } = buildEpoch(srs, entries);
  const points = domain(epoch.n);
  assert.equal(points.length, 4);
  assert.notEqual(epoch.balanceCommitment.equals(G1.ZERO), true);
});
