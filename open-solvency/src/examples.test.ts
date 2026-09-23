import test from "node:test";
import assert from "node:assert/strict";
import { matchingExample, type PublicExamples } from "./examples.ts";

test("public examples only match the selected registry, method, epoch and commitment", () => {
  const registry = `0x${"ab".repeat(20)}`;
  const example = { method: "snarkless" as const, registry, epoch: "3", commitment: "(1, 2)", account: "customer-123", balances: [], secret: "1", bundle: {} };
  const records: PublicExamples[] = [{ version: 1, chainId: 11155111, examples: [example] }];
  const snapshot = { epoch: 3n, timestamp: 0n, assets: [], commitment: "(1, 2)", data: {} };
  assert.equal(matchingExample(records, "snarkless", registry.toUpperCase(), snapshot), example);
  assert.equal(matchingExample(records, "zk-circuit", registry, snapshot), undefined);
  assert.equal(matchingExample(records, "snarkless", `0x${"cd".repeat(20)}`, snapshot), undefined);
  assert.equal(matchingExample(records, "snarkless", registry, { ...snapshot, epoch: 4n }), undefined);
  assert.equal(matchingExample(records, "snarkless", registry, { ...snapshot, commitment: "(3, 4)" }), undefined);
});
