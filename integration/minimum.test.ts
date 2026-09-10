import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { localSetup, writeDemo } from "../script/minimum-local.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { proofServer, PrototypeAuthentication } from "../backend/server.ts";
import { retrieveProof } from "../frontend/src/minimumClient.ts";
import {
  registryClient,
  anchor,
  localResult,
  checkPublicCalculation,
  publicSummary,
} from "../frontend/src/minimumClient.ts";
import { verify, audit } from "../prover/minimum/tree.ts";

test("Anvil: deploy, approve reserves, convert liabilities, finalize, render, verify, reject tampered/insolvent/stale", async () => {
  const listener = createServer();
  await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((r) => listener.close(() => r()));
  const process = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--silent"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  process.stderr.on("data", (d) => (logs += d));
  let spawnError: Error | undefined;
  process.on("error", (e) => (spawnError = e));
  const rpc = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(join(tmpdir(), "minimum-e2e-"));
  let backend: ReturnType<typeof proofServer> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      if (process.exitCode !== null) throw Error(logs);
      try {
        const r = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(50);
    }
    assert.ok(ready, "Anvil started");
    const setup = await localSetup(rpc),
      web = registryClient(rpc, setup.registry);
    const s = await web.current();
    assert.equal(s.claim.totalLiabilitiesUsd, 24000000000n);
    assert.equal(s.claim.verifiedBy.toLowerCase(), setup.auditor.toLowerCase());
    assert.ok(checkPublicCalculation(s));
    assert.match(publicSummary(s), /^SOLVENT/);
    const ledger = await web.ledger(
      s.claim.snapshotId,
      s.claim.rootHash,
      s.claim.totalLiabilitiesUsd,
      s.capacity,
    );
    assert.ok(audit(ledger));
    assert.deepEqual(ledger, setup.snapshot.ledger);
    await writeDemo(directory, setup);
    const accounts = JSON.parse(await readFile(join(directory, "accounts.private.json"), "utf8"));
    const credentials = JSON.parse(
      await readFile(join(directory, "credentials.private.json"), "utf8"),
    );
    backend = proofServer(new PrototypeAuthentication(accounts), directory);
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
    const retrieved = await retrieveProof(credentials[0].token, (path, options) =>
      fetch(backendUrl + path, options),
    );
    assert.match(
      localResult(
        retrieved,
        credentials[0].customerId,
        credentials[0].dateOfBirth,
        BigInt(credentials[0].balance),
        anchor(s),
      ),
      /^VALID/,
    );
    const queue = await web.auditQueue();
    assert.equal(queue.assets.length, 2);
    assert.equal(queue.liabilities.length, 1);
    for (const bundle of setup.snapshot.bundles) {
      assert.match(
        localResult(
          bundle,
          bundle.customerId,
          bundle.dateOfBirth,
          bundle.expectedBalance,
          anchor(s),
        ),
        /^VALID/,
      );
      const bad = structuredClone(bundle);
      bad.parts[0].amount++;
      assert.equal(
        verify(
          bad,
          {
            customerId: bundle.customerId,
            dateOfBirth: bundle.dateOfBirth,
            balance: bundle.expectedBalance,
          },
          anchor(s),
        ),
        false,
      );
    }
    const insolvent = await setup.prepare(`0x${"aa".repeat(32)}`, 20000n * 10n ** 18n);
    await setup.submit(insolvent);
    await setup.send(setup.company, "proposeClaim", [
      insolvent.ledger.snapshotId,
      [1n],
      [setup.reserveBalance],
    ]);
    await assert.rejects(() =>
      setup.send(setup.auditor, "finalizeClaim", [insolvent.ledger.snapshotId, true]),
    );
    const stale = await setup.prepare(`0x${"bb".repeat(32)}`);
    await setup.submit(stale);
    await setup.send(setup.company, "proposeClaim", [
      stale.ledger.snapshotId,
      [1n],
      [setup.reserveBalance],
    ]);
    await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_increaseTime", params: [3700] }),
    });
    await assert.rejects(() =>
      setup.send(setup.auditor, "finalizeClaim", [stale.ledger.snapshotId, true]),
    );
    assert.equal(
      (await web.current()).claim.snapshotId,
      s.claim.snapshotId,
      "failed proposals preserve current finalized history",
    );
  } finally {
    if (backend) {
      backend.closeAllConnections();
      await new Promise<void>((r) => backend!.close(() => r()));
    }
    await rm(directory, { recursive: true, force: true });
    process.kill("SIGTERM");
    await new Promise<void>((r) => {
      if (process.exitCode !== null) r();
      else process.once("exit", () => r());
    });
  }
});
