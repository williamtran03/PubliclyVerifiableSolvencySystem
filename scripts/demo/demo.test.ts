import test from "node:test";
import { createTestClient, http } from "viem";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startDemo } from "./run.ts";
import { company, demoChain, minEpochInterval } from "./chain.ts";
import { ledger } from "../../open-solvency/src/solutions/ledger.ts";
import { zk } from "../../open-solvency/src/solutions/zk.ts";
import { kzg } from "../../open-solvency/src/solutions/kzg.ts";
import { publicationCall } from "../../open-solvency/src/solutions/publish.ts";

test("three demo deployments support the site's verification and publication adapters", { timeout: 180000 }, async () => {
  const demo = await startDemo({ ports: [0, 0, 0], webPort: 0 });
  const file = (name: string) => readFileSync(join(demo.output, name), "utf8");
  try {
    for (const [solution, name, account, expected, secret] of [
      [ledger, "ledger-alice.json", "alice", new Map([[0, 100n], [1, 3n]]), ""],
      [zk, "zk-customer-123.json", "customer-123", new Map([[0, 250000000n]]), "84731920475619283746152039485761029384"],
      [kzg, "kzg-customer-123.json", "customer-123", new Map([[0, 12550n]]), "84731920475619283746152039485761029384"],
    ] as const) {
      const connection = demo.connections[solution.id];
      if (solution === ledger) {
        await createTestClient({ mode: "anvil", transport: http(connection.rpc) }).mine({ blocks: 1 });
      }
      const snapshot = await solution.read(connection);
      if (solution === ledger) assert.ok(snapshot.publicLedger?.length, "ledger remains available after a later block");
      assert.equal((await solution.verify(connection, snapshot, file(name), account, expected, secret)).valid, true, solution.id);
      const wrong = new Map(expected);
      wrong.set(0, wrong.get(0)! + 1n);
      assert.equal((await solution.verify(connection, snapshot, file(name), account, wrong, secret)).valid, false, `${solution.id} wrong balance`);
    }
    for (const solution of [ledger, kzg]) {
      const connection = demo.connections[solution.id];
      const { client, wallet, advance } = await demoChain(connection.rpc);
      const extra = solution === kzg ? new File([file("kzg-next-range-proof.json")], "range-proof.json") : undefined;
      const next = file(solution === ledger ? "ledger-next.json" : "kzg-next-epoch.json");
      await assert.rejects(publicationCall(solution.id, connection, next, extra, ""), /accepts the next epoch from/, `${solution.id} republished before the minimum interval`);
      await advance(minEpochInterval);
      const data = await publicationCall(solution.id, connection, next, extra, "");
      const receipt = await client.waitForTransactionReceipt({ hash: await wallet(company).sendTransaction({ to: connection.registry, data }) });
      assert.equal(receipt.status, "success");
      assert.equal((await solution.read(connection)).epoch, 1n);
    }
    const config = await fetch(`http://127.0.0.1:${demo.webPort}/demo-config.json`).then(r => r.json());
    assert.deepEqual(config.solutions, demo.connections);
    assert.equal(JSON.stringify(config).includes("secret"), false);
    assert.equal((await fetch(`http://127.0.0.1:${demo.webPort}/`)).status, 200);
  } finally { await demo.stop(); }
});
