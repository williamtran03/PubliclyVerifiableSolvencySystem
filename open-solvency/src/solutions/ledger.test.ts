import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, decodeFunctionData, parseAbi, zeroAddress } from "viem";
import { buildSplitLiabilities } from "../../../arms/published-ledger/prover/splitLiabilities.ts";
import { ledger, readPublicLedgerArtifact } from "./ledger.ts";

const registry = "0x1111111111111111111111111111111111111111";
const snapshotId = `0x${"ab".repeat(32)}` as const;
const transactionHash = `0x${"cd".repeat(32)}`;
const prepared = buildSplitLiabilities([{ customerId: "alice", name: "Alice", dateOfBirth: "2000-01-01", parts: [{ assetId: 0, amount: 100n }] }], snapshotId, 1);
const roots = prepared.ledger.assets.map(a => a.rootHash);
const abi = parseAbi([
  "struct Epoch { bytes32 snapshotId; uint256[] rootHashes; uint256[] liabilities; uint256[] reserves; uint64 timestamp; }",
  "function epochCount() view returns (uint256)", "function getEpoch(uint256) view returns (Epoch)",
  "function assets(uint256) view returns (address)", "function isCurrent() view returns (bool)",
  "function epochAge() view returns (uint64)", "function maxEpochAge() view returns (uint64)",
  "function submitLedger(bytes32 snapshotId, uint256[][] identities, uint256[][] amounts)",
  "event LedgerSubmitted(uint256 indexed epochId, bytes32 indexed snapshotId, uint256[] rootHashes, uint256[] liabilities, uint256[] reserves)",
]);
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);

for (const mode of ["direct", "contract-wallet", "unavailable-history", "malformed-calldata"] as const) {
  test(`ledger read supports ${mode} without losing private verification`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      let result: unknown;
      if (request.method === "eth_blockNumber") result = "0x20";
      else if (request.method === "eth_getLogs") {
        assert.equal(request.params[0].fromBlock, "0x0");
        assert.equal(request.params[0].toBlock, "0x20");
        if (mode === "unavailable-history") throw new Error("History unavailable");
        result = [{ address: registry, blockNumber: "0x10", blockHash: transactionHash, transactionHash, transactionIndex: "0x0", logIndex: "0x0", removed: false,
          topics: encodeEventTopics({ abi, eventName: "LedgerSubmitted", args: { epochId: 0n, snapshotId } }),
          data: encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256[]" }], [roots, [100n], [200n]]),
        }];
      } else if (request.method === "eth_getTransactionByHash") {
        result = { hash: transactionHash, blockHash: transactionHash, blockNumber: "0x10", transactionIndex: "0x0", from: zeroAddress,
          to: mode === "contract-wallet" ? zeroAddress : registry,
          input: mode === "direct" ? encodeFunctionData({ abi, functionName: "submitLedger", args: [snapshotId, [prepared.ledger.assets[0].entries.map(e => e.identityHash)], [[100n]]] }) : "0xdeadbeef",
          value: "0x0", nonce: "0x0", gas: "0x100000", gasPrice: "0x1", type: "0x0", v: "0x1b", r: "0x1", s: "0x1" };
      } else {
        const { functionName } = decodeFunctionData({ abi, data: request.params[0].data });
        const values: Record<string, unknown> = { epochCount: 1n, getEpoch: { snapshotId, rootHashes: roots, liabilities: [100n], reserves: [200n], timestamp: 1800000000n }, assets: zeroAddress, isCurrent: true, epochAge: 10n, maxEpochAge: 86400n };
        result = encodeFunctionResult({ abi, functionName: functionName as "epochCount", result: values[functionName] as bigint });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
    };
    try {
      const connection = { rpc: "https://ledger.test", registry } as const;
      const snapshot = await ledger.read(connection);
      assert.equal(snapshot.epoch, 0n);
      assert.equal(Boolean(snapshot.publicLedger), mode === "direct");
      assert.deepEqual(readPublicLedgerArtifact(snapshot, json(prepared.ledger))[0].entries.map(e => e.amount), [100n]);
      assert.equal((await ledger.verify(connection, snapshot, json(prepared.bundles[0]), "alice", new Map([[0, 100n]]), "")).valid, true);
    } finally { globalThis.fetch = original; }
  });
}
