import { test } from "node:test";
import assert from "node:assert/strict";
import { Fr, interpolate } from "./field.ts";
import { commit } from "./commit.ts";
import { generateSrs } from "./srs.ts";
import { blind, proveLiabilities, verifyLiabilities } from "./liabilities.ts";

const srs = generateSrs(32);
const balances = [10n, 25n, 7n, 18n];
const total = 60n;
const balancePoly = blind(balances, 2);
const balanceCommitment = commit(srs, balancePoly);
const CTX = 7n;
const BITS = 8;

test("a genuine set of non-negative balances proves and verifies its total", () => {
  const proof = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  assert.ok(verifyLiabilities(srs, balanceCommitment, total, balances.length, proof, CTX));
});

test("a proof does not carry to another epoch or deployment", () => {
  const proof = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  assert.equal(verifyLiabilities(srs, balanceCommitment, total, balances.length, proof, CTX + 1n), false);
});

test("a proof does not carry to another total", () => {
  const proof = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  assert.equal(verifyLiabilities(srs, balanceCommitment, total - 1n, balances.length, proof, CTX), false);
  assert.equal(verifyLiabilities(srs, balanceCommitment, total + 1n, balances.length, proof, CTX), false);
});

test("a balance that does not fit in the bit width is rejected up front", () => {
  const tooBig = [10n, 25n, 7n, 1n << 9n];
  assert.throws(
    () => proveLiabilities(srs, interpolate(tooBig), tooBig, 554n, CTX, BITS),
    /does not fit in 8 bits/,
  );
});

test("bits that don't actually reconstruct the balance can't even produce a proof", () => {
  const mismatchedPoly = interpolate([11n, 25n, 7n, 18n]);
  assert.throws(() => proveLiabilities(srs, mismatchedPoly, balances, total, CTX, BITS), /not divisible/);
});

test("every commitment is blinded, so the same balances never prove twice the same way", () => {
  const first = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  const second = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  assert.equal(first.bitCommitments[0].equals(second.bitCommitments[0]), false);
  assert.equal(first.accumulatorCommitment.equals(second.accumulatorCommitment), false);
  assert.ok(verifyLiabilities(srs, balanceCommitment, total, balances.length, first, CTX));
  assert.ok(verifyLiabilities(srs, balanceCommitment, total, balances.length, second, CTX));
});

test("the opened balance value is masked: two blindings of one ledger open to unrelated values", () => {
  const other = blind(balances, 2);
  const a = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  const b = proveLiabilities(srs, other, balances, total, CTX, BITS);
  assert.notEqual(a.values[0], b.values[0]);
  assert.ok(verifyLiabilities(srs, commit(srs, other), total, balances.length, b, CTX));
});

test("a bit width wide enough to wrap the field is refused", () => {
  const proof = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  assert.equal(verifyLiabilities(srs, balanceCommitment, total, balances.length, { ...proof, bits: 254 }, CTX), false);
});

test("tampering with any opened value after the fact breaks verification", () => {
  const proof = proveLiabilities(srs, balancePoly, balances, total, CTX, BITS);
  for (const index of [0, 3, BITS + 1, BITS + 2]) {
    const values = [...proof.values];
    values[index] = Fr.add(values[index], 1n);
    assert.equal(verifyLiabilities(srs, balanceCommitment, total, balances.length, { ...proof, values }, CTX), false);
  }
  const shifted = { ...proof, shiftedAccumulator: Fr.add(proof.shiftedAccumulator, 1n) };
  assert.equal(verifyLiabilities(srs, balanceCommitment, total, balances.length, shifted, CTX), false);
});
