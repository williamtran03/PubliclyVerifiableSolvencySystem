import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settleStaging } from "./epoch.ts";

test("keeps staged bundles of published epochs and drops those of unpublished ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "sepolia-bundles-"));
  const previous = process.env.PRIVATE_OUTPUT;
  process.env.PRIVATE_OUTPUT = directory;
  try {
    const arm = join(directory, "snarkless");
    for (const name of ["epoch-0", "epoch-1.pending", "epoch-2.pending"]) {
      mkdirSync(join(arm, name), { recursive: true });
      writeFileSync(join(arm, name, "customer-123.json"), name);
    }
    settleStaging("snarkless", 2n);
    assert.deepEqual(readdirSync(arm).sort(), ["epoch-0", "epoch-1"]);
    assert.equal(readFileSync(join(arm, "epoch-1", "customer-123.json"), "utf8"), "epoch-1.pending");

    mkdirSync(join(arm, "epoch-1.pending"));
    assert.throws(() => settleStaging("snarkless", 2n), /both .* exist/);
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_OUTPUT;
    else process.env.PRIVATE_OUTPUT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
