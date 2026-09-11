import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSrs } from "./srs.ts";
import { verify } from "./commit.ts";
import { buildGrandSumEpoch } from "./grandSum.ts";

const srs = generateSrs(32);

test("total liabilities matches the plain sum of balances", () => {
  const balances = [10n, 25n, 7n, 18n];
  const epoch = buildGrandSumEpoch(srs, balances);
  assert.equal(epoch.totalLiabilities, balances.reduce((a, b) => a + b, 0n));
});

test("the opening verifies against the published commitment", () => {
  const epoch = buildGrandSumEpoch(srs, [10n, 25n, 7n, 18n]);
  assert.ok(verify(srs, epoch.commitment, epoch.opening));
});

test("fewer real customers than capacity are padded with zero balances", () => {
  const epoch = buildGrandSumEpoch(srs, [10n, 25n]);
  assert.equal(epoch.totalLiabilities, 35n);
  assert.ok(verify(srs, epoch.commitment, epoch.opening));
});

test("more balances than the fixed capacity is rejected", () => {
  assert.throws(() => buildGrandSumEpoch(srs, new Array(9).fill(1n)), /too many balances/);
});

test("a tampered opening value fails verification", () => {
  const epoch = buildGrandSumEpoch(srs, [10n, 25n, 7n, 18n]);
  const tampered = { ...epoch.opening, value: epoch.opening.value + 1n };
  assert.equal(verify(srs, epoch.commitment, tampered), false);
});
