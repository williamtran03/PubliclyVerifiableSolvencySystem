import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputPath } from "./outputPath.ts";
import { writePrivate } from "../scripts/sepolia/network.ts";
import { writeJson } from "../scripts/demo/chain.ts";

test("bundle writers reject paths without touching files outside the output directory", () => {
  const base = mkdtempSync(join(tmpdir(), "bundle-path-"));
  const directory = join(base, "private");
  mkdirSync(directory);
  writeFileSync(join(base, "victim.json"), "keep me");
  try {
    for (const name of ["../victim.json", "..\\victim.json", join(base, "victim.json"), "nested/customer.json", "C:\\victim.json", "bad\0.json"]) {
      assert.throws(() => outputPath(directory, name), /filename/);
      for (const write of [writePrivate, writeJson]) assert.throws(() => write(directory, name, {}), /filename/);
    }
    assert.equal(readFileSync(join(base, "victim.json"), "utf8"), "keep me");
    assert.deepEqual(readdirSync(directory), []);
    for (const [i, write] of [writePrivate, writeJson].entries()) {
      write(directory, `customer-${i}.json`, { balance: 5n });
      assert.deepEqual(JSON.parse(readFileSync(join(directory, `customer-${i}.json`), "utf8")), { balance: "5" });
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});
