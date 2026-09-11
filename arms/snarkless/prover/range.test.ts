import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate } from "./field.ts";
import { commit } from "./commit.ts";
import { generateSrs } from "./srs.ts";
import { proveRange, verifyRange } from "./range.ts";

const srs = generateSrs(32);
const balances = [10n, 25n, 7n, 18n];
const balancePoly = interpolate(balances);
const balanceCommitment = commit(srs, balancePoly);
const BITS = 8;

test("a genuine set of non-negative balances proves and verifies", () => {
  const proof = proveRange(srs, balancePoly, balances, BITS);
  assert.ok(verifyRange(srs, balanceCommitment, balances.length, proof));
});

test("a balance that does not fit in the bit width is rejected up front", () => {
  const tooBig = [10n, 25n, 7n, 1n << 9n];
  const poly = interpolate(tooBig);
  assert.throws(() => proveRange(srs, poly, tooBig, BITS), /does not fit in 8 bits/);
});

test("bits that don't actually reconstruct the balance can't even produce a proof", () => {
  const mismatchedPoly = interpolate([11n, 25n, 7n, 18n]);
  assert.throws(() => proveRange(srs, mismatchedPoly, balances, BITS), /not divisible/);
});

test("bit commitments are blinded, so the same balances never commit twice the same way", () => {
  const first = proveRange(srs, balancePoly, balances, BITS);
  const second = proveRange(srs, balancePoly, balances, BITS);

  const asPair = (p: { x: bigint; y: bigint }) => `${p.x},${p.y}`;
  assert.notEqual(
    asPair(first.bitCommitments[0].toAffine()),
    asPair(second.bitCommitments[0].toAffine()),
  );
  assert.ok(verifyRange(srs, balanceCommitment, balances.length, first));
  assert.ok(verifyRange(srs, balanceCommitment, balances.length, second));
});

test("tampering with one opened value after the fact breaks verification", () => {
  const proof = proveRange(srs, balancePoly, balances, BITS);
  const tamperedValues = [...proof.values];
  tamperedValues[0] = tamperedValues[0] + 1n;
  const tampered = { ...proof, values: tamperedValues };
  assert.equal(verifyRange(srs, balanceCommitment, balances.length, tampered), false);
});
