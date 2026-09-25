import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, type Hex, type TransactionReceipt } from "viem";
import { broadcastJournaled, finalizeTransaction } from "./journal.ts";
import { saveRecord } from "./record.ts";
import type { Deployment } from "./network.ts";

const address = "0x1111111111111111111111111111111111111111";
const raw: Hex = "0x1234";
const hash = keccak256(raw);
const pending = { step: "TEST", label: "deploy DemoAsset", hash, serializedTransaction: raw, sender: address, nonce: 0 } as const;
const empty = (): Deployment => ({ network: "sepolia", chainId: 11155111, roles: { company: address, auditor: address }, parameters: { maxEpochAge: "604800", minEpochInterval: "60" }, contracts: {}, reserves: {}, deployBlocks: {}, epochs: [], transactions: [] });
const receipt = { transactionHash: hash, blockNumber: 10n, gasUsed: 100n, status: "success", contractAddress: address, blockHash: hash, cumulativeGasUsed: 100n, effectiveGasPrice: 1n, from: address, to: null, logs: [], logsBloom: "0x", transactionIndex: 0, type: "eip1559" } satisfies TransactionReceipt;

test("persists before broadcast and recovers a lost broadcast response without losing the signed transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sepolia-journal-"));
  try {
    const file = join(directory, "record.json");
    const record = empty();
    const persist = (next: Deployment) => saveRecord(file, next);
    await assert.rejects(broadcastJournaled(record, persist, pending, async () => {
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).pending, pending);
      throw new Error("lost RPC response after acceptance");
    }), /lost RPC response/);
    const restarted: Deployment = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(restarted.pending?.serializedTransaction, raw);
    finalizeTransaction(restarted, persist, receipt);
    const saved: Deployment = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.pending, undefined);
    assert.equal(saved.contracts.TEST, address);
    assert.equal(saved.deployBlocks.TEST, "10");
    assert.equal(saved.transactions.length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a failed journal write cannot broadcast or modify the live record", async () => {
  const record = empty();
  let broadcasts = 0;
  await assert.rejects(broadcastJournaled(record, () => { throw new Error("disk full"); }, pending, async () => { broadcasts++; return hash; }), /disk full/);
  assert.equal(broadcasts, 0);
  assert.equal(record.pending, undefined);
});

test("deployment finalization survives a failed save and atomically retries without duplicates", () => {
  const progress = { snarkless: 1 };
  const record = { ...empty(), pending, operations: progress };
  const before = structuredClone(record);
  assert.throws(() => finalizeTransaction(record, () => { throw new Error("interrupted save"); }, receipt), /interrupted save/);
  assert.deepEqual(record, before);
  let writes = 0;
  finalizeTransaction(record, next => {
    writes++;
    assert.equal(next.pending, undefined);
    assert.equal(next.contracts.TEST, address);
    assert.equal(next.transactions.length, 1);
  }, receipt);
  assert.equal(writes, 1);
  assert.equal(record.pending, undefined);
  progress.snarkless = 2;
  assert.equal(record.operations.snarkless, 2, "operations checkpoints must retain their live reference");
});

test("epoch finalization records its original ID and receipt in the same write", () => {
  const record: Deployment = { ...empty(), pending: { ...pending, step: "snarkless", label: "submitEpoch", epochId: "3" } };
  const epoch = { arm: "snarkless", epochId: "3", hash, block: "10", gasUsed: "100", timestamp: "123" } as const;
  assert.throws(() => finalizeTransaction(record, () => { throw new Error("disk full"); }, receipt, epoch), /disk full/);
  assert.equal(record.epochs.length, 0);
  assert.ok(record.pending);
  finalizeTransaction(record, next => {
    assert.equal(next.pending, undefined);
    assert.deepEqual(next.epochs, [epoch]);
    assert.equal(next.transactions.length, 1);
  }, receipt, epoch);
  record.pending = { ...pending, step: "snarkless", label: "submitEpoch", epochId: "3" };
  finalizeTransaction(record, () => {}, receipt, epoch);
  assert.equal(record.epochs.length, 1);
  assert.equal(record.transactions.length, 1);
});

test("reverted deployments record the receipt without inventing a contract", () => {
  const record: Deployment = { ...empty(), pending };
  finalizeTransaction(record, () => {}, { ...receipt, status: "reverted", contractAddress: null });
  assert.deepEqual(record.contracts, {});
  assert.equal(record.pending, undefined);
  assert.equal(record.transactions.length, 1);
});

test("rejects another pending transaction, corrupt signatures and unrelated receipts", async () => {
  const record: Deployment = { ...empty(), pending };
  await assert.rejects(broadcastJournaled(record, () => {}, pending, async () => hash), /Recover/);
  await assert.rejects(broadcastJournaled(empty(), () => {}, { ...pending, hash: keccak256("0xab") }, async () => hash), /hash mismatch/);
  assert.throws(() => finalizeTransaction(record, () => {}, { ...receipt, transactionHash: keccak256("0xab") }), /does not match/);
  assert.ok(record.pending);
});
