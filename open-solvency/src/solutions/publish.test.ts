import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, parseAbi } from "viem";
import { buildTree, keccakHash } from "../../../arms/published-ledger/prover/tree.ts";
import { publicationCall } from "./publish.ts";

const rpc = "http://127.0.0.1:8799";
const registry = "0x34A1D3fff3958843C43aD80F30b94c510645C316" as const;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function withRpc(result: (method: string, data?: string) => string, work: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: result(request.method, request.params?.[0]?.data) }), { headers: { "content-type": "application/json" } });
  };
  return work().finally(() => { globalThis.fetch = original; });
}

test("published ledger submission uses recomputed entries", async () => {
  const entries = [{ username: "", identityHash: 12n, balance: 50n }];
  const root = buildTree(entries, keccakHash).root;
  const raw = { snapshotId: `0x${"ab".repeat(32)}`, assets: [{ rootHash: String(root.hash), totalLiabilities: String(root.sum), entries: [{ identityHash: "12", balance: "50" }] }] };
  await withRpc(() => word(1n), async () => {
    const data = await publicationCall("published-ledger", { rpc, registry }, JSON.stringify(raw), undefined, "");
    const decoded = decodeFunctionData({ abi: parseAbi(["function submitLedger(bytes32,uint256[][],uint256[][])"]), data });
    assert.equal(decoded.functionName, "submitLedger");
    assert.deepEqual(decoded.args?.[1], [[12n]]);
    raw.assets[0].entries[0].balance = "51";
    await assert.rejects(publicationCall("published-ledger", { rpc, registry }, JSON.stringify(raw), undefined, ""), /root and total/);
  });
});

test("KZG submission encodes the generated fixture for the next epoch", async () => {
  const epoch = readFileSync("arms/snarkless/fixtures/epoch.json", "utf8");
  const range = readFileSync("arms/snarkless/fixtures/range-proof.json", "utf8");
  const parsed = JSON.parse(epoch);
  let calls = 0;
  await withRpc((method) => method === "eth_chainId" ? "0x7a69" : ++calls === 1 ? word(0n) : word(BigInt(parsed.context)), async () => {
    const proof = new File([range], "range-proof.json", { type: "application/json" });
    const calldata = await publicationCall("snarkless", { rpc, registry }, epoch, proof, "");
    assert.ok(calldata.startsWith("0x"));
    assert.ok(calldata.length > 3000);
  });
});

test("ZK submission binds the fixture to the next epoch and three oracle rounds", async () => {
  const artifact = readFileSync("arms/zk-circuit/fixtures/epoch.json", "utf8");
  const parsed = JSON.parse(artifact);
  let calls = 0;
  await withRpc(() => ++calls === 1 ? word(0n) : word(BigInt(parsed.context)), async () => {
    const proof = new File([new Uint8Array([1, 2, 3])], "proof.bin");
    const calldata = await publicationCall("zk-circuit", { rpc, registry }, artifact, proof, "1, 2, 3");
    const decoded = decodeFunctionData({ abi: parseAbi(["function submitEpoch(bytes,uint256,uint64[3],uint80[3])"]), data: calldata });
    assert.equal(decoded.functionName, "submitEpoch");
    assert.deepEqual(decoded.args?.[3], [1n, 2n, 3n]);
  });
});
