import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { audit, parse, type Ledger } from "./tree.ts";
test("operator CLI builds private outputs and audits independent records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minimum-cli-"));
  const file = join(dir, "source.private.json"),
    out = join(dir, "snapshot");
  const input = {
    snapshotId: `0x${"01".repeat(32)}`,
    snapshotTime: "1000",
    snapshotBlock: "9",
    maxAge: "60",
    capacity: 8,
    minParts: 2,
    maxParts: 2,
    rates: [
      {
        token: "0x0000000000000000000000000000000000000001",
        feed: "0x0000000000000000000000000000000000000002",
        tokenDecimals: 6,
        oracleDecimals: 8,
        rate: "100000000",
        roundId: "1",
        updatedAt: "1000",
      },
    ],
    customers: [
      {
        customerId: "private-customer",
        dateOfBirth: "2000-01-01",
        holdings: [{ token: "0x0000000000000000000000000000000000000001", rawAmount: "1000000" }],
      },
    ],
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "cli/minimum.ts", ...args], {
      encoding: "utf8",
    });
  try {
    await writeFile(file, JSON.stringify(input));
    let r = run(["build", file, out]);
    assert.equal(r.status, 0, r.stderr);
    const ledger = parse<Ledger>(await readFile(join(out, "ledger.json"), "utf8"));
    assert.ok(audit(ledger));
    r = run(["audit", join(out, "ledger.json")]);
    assert.equal(r.status, 0, r.stderr);
    r = run(["audit-private", file, out]);
    assert.equal(r.status, 0, r.stderr);
    input.customers[0].holdings[0].rawAmount = "2000000";
    await writeFile(file, JSON.stringify(input));
    assert.notEqual(run(["audit-private", file, out]).status, 0);
    assert.notEqual(run(["build", file, out]).status, 0, "must not overwrite an existing snapshot");
    assert.ok(!(await readFile(join(out, "ledger.json"), "utf8")).includes("private-customer"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
