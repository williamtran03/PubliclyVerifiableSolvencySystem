import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSrs } from "./srs.ts";
import { commit, commitShifted, open, verifyDegreeBound } from "./commit.ts";
import { Fr } from "./field.ts";
import { add, mul } from "./poly.ts";
import { proveRange, verifyRange } from "./range.ts";
import {
  buildGrandSumEpoch,
  proveInclusion,
  verifyGrandSum,
  verifyInclusion,
  type Account,
} from "./grandSum.ts";

const srs = generateSrs(32);
const accounts: Account[] = [
  { username: "customer-123", salt: 111n, balance: 12550n },
  { username: "customer-456", salt: 222n, balance: 5000n },
  { username: "customer-789", salt: 333n, balance: 32000n },
];
const vanishing = [Fr.neg(Fr.ONE), 0n, 0n, 0n, 0n, 0n, 0n, 0n, Fr.ONE]; // X^8 − 1

test("total liabilities matches the plain sum of balances", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  assert.equal(epoch.totalLiabilities, 49550n);
});

test("the published total verifies: degree bound, opening at 0, n·p(0)", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  assert.ok(
    verifyGrandSum(srs, epoch.balanceCommitment, epoch.shiftedCommitment, epoch.opening, epoch.totalLiabilities),
  );
});

test("a wrong total or tampered opening fails", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const { balanceCommitment, shiftedCommitment, opening } = epoch;
  assert.equal(verifyGrandSum(srs, balanceCommitment, shiftedCommitment, opening, 49549n), false);
  const tampered = { ...opening, value: Fr.add(opening.value, 1n) };
  assert.equal(verifyGrandSum(srs, balanceCommitment, shiftedCommitment, tampered, Fr.mul(8n, tampered.value)), false);
});

test("adding a multiple of the vanishing polynomial can no longer understate the total", () => {
  // The attack found on 2026-09-13: same balances on the domain, constant term lower by 5000,
  // so the published total drops from 49,550 to 9,550 while the opening and range proof verify.
  const honest = buildGrandSumEpoch(srs, accounts);
  const cheat = add(honest.balancePoly, mul(vanishing, [5000n]));
  const cheatCommitment = commit(srs, cheat);
  const cheatOpening = open(srs, cheat, 0n);
  const understated = Fr.mul(8n, cheatOpening.value);
  assert.equal(understated, 9550n);

  // Both halves of the old check still pass...
  assert.ok(verifyRange(srs, cheatCommitment, 8, proveRange(srs, cheat, honest.balances)));

  // ...but the degree-8 polynomial has no shifted commitment inside the SRS,
  assert.throws(() => commitShifted(srs, cheat), /exceeds the bound/);
  // and the honest shifted commitment does not pair with the cheating one.
  assert.equal(verifyDegreeBound(srs, cheatCommitment, honest.shiftedCommitment), false);
  assert.equal(verifyGrandSum(srs, cheatCommitment, honest.shiftedCommitment, cheatOpening, understated), false);
});

test("fewer real customers than capacity are padded with zero balances", () => {
  const epoch = buildGrandSumEpoch(srs, accounts.slice(0, 2));
  assert.equal(epoch.totalLiabilities, 17550n);
});

test("more balances than the fixed capacity is rejected", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ username: `c${i}`, salt: 1n, balance: 1n }));
  assert.throws(() => buildGrandSumEpoch(srs, many), /too many balances/);
});

test("every customer verifies their own slot", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  accounts.forEach((account, index) => {
    assert.ok(verifyInclusion(srs, epoch, account, proveInclusion(srs, epoch, index)), account.username);
  });
});

test("a wrong balance, salt or slot fails inclusion", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveInclusion(srs, epoch, 1);
  assert.equal(verifyInclusion(srs, epoch, { ...accounts[1], balance: 5001n }, proof), false);
  assert.equal(verifyInclusion(srs, epoch, { ...accounts[1], salt: 999n }, proof), false);
  assert.equal(verifyInclusion(srs, epoch, accounts[1], { ...proof, index: 2 }), false);
  assert.equal(verifyInclusion(srs, epoch, accounts[0], proof), false);
});

test("two customers cannot be pointed at one slot", () => {
  // Same username issued twice, but the second customer's own salt differs.
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveInclusion(srs, epoch, 0);
  const second: Account = { username: "customer-123", salt: 444n, balance: 12550n };
  assert.equal(verifyInclusion(srs, epoch, second, proof), false);
});

test("an SRS bounding a different degree is refused", () => {
  assert.throws(() => buildGrandSumEpoch(generateSrs(32, 8), accounts), /must bound degree 7/);
});
