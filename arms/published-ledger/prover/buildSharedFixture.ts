import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import assert from "node:assert/strict";
import { toHex } from "viem";
import { buildSplitLiabilities, verifyCustomer, verifyPublicLedger, type Customer } from "./splitLiabilities.ts";

const output = process.argv[2] ?? "arms/published-ledger/fixtures/shared-customers.json";

const accounts = readFileSync("shared/customers.csv", "utf8").trim().split("\n").slice(1).map((row) => {
  const [username, balance] = row.split(",");
  return { username: username.trim(), balance: BigInt(balance.trim()) };
});

function customers(partsPerCustomer: number): Customer[] {
  return accounts.map(({ username, balance }) => {
    assert.ok(balance >= BigInt(partsPerCustomer), `${username} cannot be split into ${partsPerCustomer} non-zero parts`);
    const amounts: bigint[] = [];
    let left = balance;
    for (let i = partsPerCustomer; i > 1; i--) {
      const amount = BigInt(randomInt(1, Number(left - BigInt(i - 1)) + 1));
      amounts.push(amount);
      left -= amount;
    }
    amounts.push(left);
    return { customerId: username, name: username, dateOfBirth: "", parts: amounts.map((amount) => ({ assetId: 0, amount })) };
  });
}

function build(partsPerCustomer: number) {
  const list = customers(partsPerCustomer);
  const { ledger, bundles } = buildSplitLiabilities(list, toHex(randomBytes(32)), 1);
  assert.ok(verifyPublicLedger(ledger), "the published ledger must rebuild to its own root");
  list.forEach((customer, i) => {
    const owed = new Map([[0, customer.parts.reduce((total, part) => total + part.amount, 0n)]]);
    const published = { snapshotId: ledger.snapshotId, assets: ledger.assets.map(({ rootHash, totalLiabilities }) => ({ rootHash, totalLiabilities })) };
    assert.ok(verifyCustomer(bundles[i], owed, published), `${customer.customerId} must verify against the root`);
  });
  const [asset] = ledger.assets;
  return {
    partsPerCustomer,
    snapshotId: ledger.snapshotId,
    rootHash: asset.rootHash.toString(),
    totalLiabilities: asset.totalLiabilities.toString(),
    identities: asset.entries.map((e) => e.identityHash.toString()),
    amounts: asset.entries.map((e) => e.balance.toString()),
  };
}

const fixture = { source: "shared/customers.csv", whole: build(1), split: build(2) };
const expected = accounts.reduce((total, a) => total + a.balance, 0n).toString();
assert.equal(fixture.whole.totalLiabilities, expected);
assert.equal(fixture.split.totalLiabilities, expected);
writeFileSync(output, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${output}: ${accounts.length} customers, ${expected} units, ${fixture.whole.identities.length} and ${fixture.split.identities.length} parts`);
