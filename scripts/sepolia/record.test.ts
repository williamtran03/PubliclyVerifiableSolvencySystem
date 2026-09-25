import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRecord } from "./record.ts";

test("replaces complete records and preserves the previous record on serialization failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "sepolia-record-"));
  try {
    const file = join(directory, "deployments", "sepolia.json");
    saveRecord(file, { operations: { snarkless: 1 } });
    saveRecord(file, { operations: { snarkless: 2 } });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { operations: { snarkless: 2 } });
    const before = readFileSync(file, "utf8");
    assert.throws(() => saveRecord(file, { invalid: 1n }), /BigInt/);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(readdirSync(join(directory, "deployments")), ["sepolia.json"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("cleans staging files when the final rename fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "sepolia-record-"));
  try {
    const occupied = join(directory, "sepolia.json");
    mkdirSync(occupied);
    writeFileSync(join(occupied, "keep"), "unchanged");
    assert.throws(() => saveRecord(occupied, { operations: {} }));
    assert.equal(readFileSync(join(occupied, "keep"), "utf8"), "unchanged");
    assert.deepEqual(readdirSync(directory), ["sepolia.json"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
