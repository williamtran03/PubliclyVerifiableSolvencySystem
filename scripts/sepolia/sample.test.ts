import test from "node:test";
import assert from "node:assert/strict";
import { buildSplitLiabilities } from "../../arms/published-ledger/prover/splitLiabilities.ts";
import { ledger } from "../../open-solvency/src/solutions/ledger.ts";
import { publicSampleBundle, samples } from "./sample.ts";

test("sample export strips private metadata while preserving a verifiable fictional ledger bundle", async () => {
  const snapshotId = `0x${"ab".repeat(32)}` as const;
  const { bundles, ledger: published } = buildSplitLiabilities([
    { customerId: "alice", name: "Alice Example", dateOfBirth: "2000-01-01", parts: [{ assetId: 0, amount: 100000000000000n }, { assetId: 1, amount: 3n }] },
    { customerId: "bob", name: "Bob Example", dateOfBirth: "2001-02-03", parts: [{ assetId: 0, amount: 20000000000000n }] },
  ], snapshotId, 2);
  const raw = JSON.parse(JSON.stringify(bundles[0], (_, v) => typeof v === "bigint" ? v.toString() : v));
  raw.privateNotes = "do not publish";
  raw.parts[0].proof.entry.privateKey = "do not publish";
  const clean = publicSampleBundle("published-ledger", raw);
  const text = JSON.stringify(clean);
  assert.ok(!text.includes("do not publish"));
  assert.ok(!text.includes("bob"));
  const snapshot = { epoch: 0n, timestamp: 0n, commitment: snapshotId, assets: [], data: {
    snapshotId, roots: published.assets.map(a => a.rootHash), liabilities: published.assets.map(a => a.totalLiabilities),
  } };
  const connection = { rpc: "https://unused.test", registry: `0x${"11".repeat(20)}` as const };
  const expected = new Map(samples["published-ledger"].balances.map(([i, n]) => [i, BigInt(n)]));
  assert.equal((await ledger.verify(connection, snapshot, text, "alice", expected, "")).valid, true);
  expected.set(0, 100000000000001n);
  assert.equal((await ledger.verify(connection, snapshot, text, "alice", expected, "")).valid, false);
  assert.throws(() => publicSampleBundle("published-ledger", { ...raw, name: "Real customer" }), /fictional/);
});

test("sample export rejects bulk files and other customer identities", () => {
  assert.throws(() => publicSampleBundle("snarkless", [{ username: "customer-123" }]), /object/);
  assert.throws(() => publicSampleBundle("zk-circuit", { username: "customer-456", parts: [] }), /fictional/);
  assert.throws(() => publicSampleBundle("snarkless", { username: "customer-456" }), /fictional/);
});
