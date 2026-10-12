import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSrs } from "./srs.ts";
import { commit } from "./commit.ts";
import { customerSecretCommitment } from "../../../shared/merkleSumTree.ts";
import { add, mul } from "./poly.ts";
import { proveLiabilities, vanishingPoly, verifyLiabilities } from "./liabilities.ts";
import { buildGrandSumEpoch, proveInclusion, verifyInclusion, type Account } from "./grandSum.ts";

const CTX = 7n;

const srs = generateSrs(32);
const accounts: Account[] = [
  { username: "customer-123", secretCommitment: customerSecretCommitment((1n << 200n) + 111n), balance: 12550n },
  { username: "customer-456", secretCommitment: customerSecretCommitment((1n << 201n) + 222n), balance: 5000n },
  { username: "customer-789", secretCommitment: customerSecretCommitment((1n << 202n) + 333n), balance: 32000n },
];
const customerAt = (index: number) => ({ username: accounts[index].username, secret: (1n << BigInt(200 + index)) + BigInt((index + 1) * 111), balance: accounts[index].balance });

test("total liabilities matches the plain sum of balances", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  assert.equal(epoch.totalLiabilities, 49550n);
});

test("the published total verifies through the running sum", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveLiabilities(srs, epoch.balancePoly, epoch.balances, epoch.totalLiabilities, CTX);
  assert.ok(verifyLiabilities(srs, epoch.balanceCommitment, epoch.totalLiabilities, 8, proof, CTX));
  assert.equal(verifyLiabilities(srs, epoch.balanceCommitment, 49549n, 8, proof, CTX), false);
});

test("a padded balance polynomial keeps every slot and still proves only the true total", () => {
  const honest = buildGrandSumEpoch(srs, accounts);
  const cheat = add(honest.balancePoly, mul(vanishingPoly(8), [5000n]));
  const cheatCommitment = commit(srs, cheat);
  const proof = proveLiabilities(srs, cheat, honest.balances, 49550n, CTX);
  assert.ok(verifyLiabilities(srs, cheatCommitment, 49550n, 8, proof, CTX));
  assert.equal(verifyLiabilities(srs, cheatCommitment, 9550n, 8, proof, CTX), false);
  assert.throws(
    () => proveLiabilities(srs, cheat, [12550n, 5000n, 0n, 0n, 0n, 0n, 0n, 0n], 17550n, CTX),
    /not divisible/,
    "bits and running sums for an understated ledger do not fit the committed balances",
  );
});

test("the balance commitment is blinded, so equal ledgers never commit the same way", () => {
  const first = buildGrandSumEpoch(srs, accounts);
  const second = buildGrandSumEpoch(srs, accounts);
  assert.equal(first.balanceCommitment.equals(second.balanceCommitment), false);
  accounts.forEach((_, index) => {
    assert.ok(verifyInclusion(srs, second, customerAt(index), proveInclusion(srs, second, index, CTX), CTX));
  });
});

test("fewer real customers than capacity are padded with zero balances", () => {
  const epoch = buildGrandSumEpoch(srs, accounts.slice(0, 2));
  assert.equal(epoch.totalLiabilities, 17550n);
});

test("more balances than the fixed capacity is rejected", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ username: `c${i}`, secretCommitment: customerSecretCommitment((1n << 200n) + 1n), balance: 1n }));
  assert.throws(() => buildGrandSumEpoch(srs, many), /too many balances/);
});

test("every customer verifies their own slot", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  accounts.forEach((account, index) => {
    assert.ok(verifyInclusion(srs, epoch, customerAt(index), proveInclusion(srs, epoch, index, CTX), CTX), account.username);
  });
});

test("an inclusion proof does not carry to another epoch or deployment", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveInclusion(srs, epoch, 0, CTX);
  assert.ok(verifyInclusion(srs, epoch, customerAt(0), proof, CTX));
  assert.equal(verifyInclusion(srs, epoch, customerAt(0), proof, CTX + 1n), false);
});

test("a wrong balance, secret or slot fails inclusion", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveInclusion(srs, epoch, 1, CTX);
  assert.equal(verifyInclusion(srs, epoch, { ...customerAt(1), balance: 5001n }, proof, CTX), false);
  assert.equal(verifyInclusion(srs, epoch, { ...customerAt(1), secret: 999n }, proof, CTX), false);
  assert.equal(verifyInclusion(srs, epoch, customerAt(1), { ...proof, index: 2 }, CTX), false);
  assert.equal(verifyInclusion(srs, epoch, customerAt(0), proof, CTX), false);
});

test("two customers cannot be pointed at one slot", () => {
  const epoch = buildGrandSumEpoch(srs, accounts);
  const proof = proveInclusion(srs, epoch, 0, CTX);
  const second = { username: "customer-123", secret: (1n << 200n) + 444n, balance: 12550n };
  assert.equal(verifyInclusion(srs, epoch, second, proof, CTX), false);
});
