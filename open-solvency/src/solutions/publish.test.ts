import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { buildTree, keccakHash } from "../../../arms/published-ledger/prover/tree.ts";
import { publicationCall } from "./publish.ts";

const rpc = "http://127.0.0.1:8799";
const registry = "0x34A1D3fff3958843C43aD80F30b94c510645C316" as const;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const NOW = 1_700_000_000n;

type Chain = { calls?: Record<string, bigint>; timestamp?: bigint };

function withRpc(chain: Chain, work: () => Promise<void>): Promise<void> {
  const calls: Record<string, bigint> = { window: 2n, sampledWindow: 2n, sampledBlock: 15n, lastEpochAt: NOW - 3600n, minEpochInterval: 3600n, ...chain.calls };
  const bySelector = new Map<string, bigint>(Object.entries(calls).map(([name, value]) => [toFunctionSelector(name.includes("(") ? name : `${name}()`), value]));
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
    if (request.method === "eth_chainId") return reply("0x7a69");
    if (request.method === "eth_getBlockByNumber") return reply({ number: "0x10", hash: `0x${"11".repeat(32)}`, timestamp: `0x${(chain.timestamp ?? NOW).toString(16)}`, transactions: [] });
    const data: string = request.params?.[0]?.data ?? "";
    const value = bySelector.get(data.slice(0, 10));
    if (value === undefined) throw new Error(`unexpected call ${data.slice(0, 10)}`);
    return reply(word(value));
  };
  return work().finally(() => { globalThis.fetch = original; });
}

test("published ledger submission uses recomputed entries", async () => {
  const entries = [{ username: "", identityHash: 12n, balance: 50n }];
  const root = buildTree(entries, keccakHash).root;
  const raw = { snapshotId: `0x${"ab".repeat(32)}`, assets: [{ rootHash: String(root.hash), totalLiabilities: String(root.sum), entries: [{ identityHash: "12", balance: "50" }] }] };
  await withRpc({ calls: { assetCount: 1n } }, async () => {
    const data = await publicationCall("published-ledger", { rpc, registry }, JSON.stringify(raw), undefined, "");
    const decoded = decodeFunctionData({ abi: parseAbi(["function submitLedger(bytes32,uint256[][],uint256[][])"]), data });
    assert.equal(decoded.functionName, "submitLedger");
    assert.deepEqual(decoded.args?.[1], [[12n]]);
    raw.assets[0].entries[0].balance = "51";
    await assert.rejects(publicationCall("published-ledger", { rpc, registry }, JSON.stringify(raw), undefined, ""), /root and total/);
  });
});

test("publication waits for the minimum interval and the auditor's sample", async () => {
  const raw = JSON.stringify({ snapshotId: `0x${"ab".repeat(32)}`, assets: [] });
  await withRpc({ timestamp: NOW - 1n }, async () => {
    await assert.rejects(publicationCall("published-ledger", { rpc, registry }, raw, undefined, ""), /accepts the next epoch from/);
  });
  await withRpc({ calls: { sampledWindow: 1n } }, async () => {
    await assert.rejects(publicationCall("published-ledger", { rpc, registry }, raw, undefined, ""), /not sampled the reserves/);
  });
  await withRpc({ calls: { sampledBlock: 16n } }, async () => {
    await assert.rejects(publicationCall("published-ledger", { rpc, registry }, raw, undefined, ""), /next block/);
  });
});

test("KZG submission encodes the generated fixture for the next epoch", async () => {
  const epoch = readFileSync("arms/snarkless/fixtures/epoch.json", "utf8");
  const range = readFileSync("arms/snarkless/fixtures/range-proof.json", "utf8");
  const parsed = JSON.parse(epoch);
  await withRpc({ calls: { epochCount: 0n, "epochContext(uint256)": BigInt(parsed.context) } }, async () => {
    const proof = new File([range], "range-proof.json", { type: "application/json" });
    const calldata = await publicationCall("snarkless", { rpc, registry }, epoch, proof, "");
    assert.ok(calldata.startsWith("0x"));
    assert.ok(calldata.length > 3000);
  });
});

test("ZK submission binds the fixture to the next epoch and three oracle rounds", async () => {
  const artifact = readFileSync("arms/zk-circuit/fixtures/epoch.json", "utf8");
  const parsed = JSON.parse(artifact);
  await withRpc({ calls: { epochCount: 0n, "epochContext(uint256)": BigInt(parsed.context) } }, async () => {
    const proof = new File([new Uint8Array([1, 2, 3])], "proof.bin");
    const calldata = await publicationCall("zk-circuit", { rpc, registry }, artifact, proof, "1, 2, 3");
    const decoded = decodeFunctionData({ abi: parseAbi(["function submitEpoch(bytes,uint256,uint64[3],uint80[3])"]), data: calldata });
    assert.equal(decoded.functionName, "submitEpoch");
    assert.deepEqual(decoded.args?.[3], [1n, 2n, 3n]);
  });
});

test("wallet submission stops if inputs change while the account request is pending", async () => {
  const { submitWithWallet } = await import("./publish.ts");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let current = true;
  const methods: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: { async request({ method }: { method: string }) {
    methods.push(method);
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_requestAccounts") { current = false; return [registry]; }
    throw new Error(`Unexpected wallet request ${method}`);
  } } } });
  try {
    await withRpc({}, async () => {
      await assert.rejects(submitWithWallet({ rpc, registry }, "0x1234", () => current), /inputs changed/);
      assert.equal(methods.includes("eth_sendTransaction"), false);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("wallet submission asks a wallet on another chain to switch to the RPC's chain", async () => {
  const { submitWithWallet } = await import("./publish.ts");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let walletChain = "0xaa36a7";
  const methods: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: { async request({ method, params }: { method: string; params?: { chainId: string }[] }) {
    methods.push(method);
    if (method === "eth_chainId") return walletChain;
    if (method === "wallet_switchEthereumChain") { walletChain = params![0].chainId; return null; }
    if (method === "eth_requestAccounts") return [registry];
    if (method === "eth_call") return "0x";
    if (method === "eth_sendTransaction") return `0x${"12".repeat(32)}`;
    throw new Error(`Unexpected wallet request ${method}`);
  } } } });
  try {
    await withRpc({}, async () => {
      assert.equal(await submitWithWallet({ rpc, registry }, "0x1234"), `0x${"12".repeat(32)}`);
      assert.deepEqual(methods.slice(0, 3), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
      walletChain = "0x1";
      methods.length = 0;
      const refusing = (globalThis as unknown as { window: { ethereum: { request(args: { method: string }): Promise<unknown> } } }).window.ethereum;
      const request = refusing.request;
      refusing.request = async (args) => { if (args.method === "wallet_switchEthereumChain") throw new Error("User rejected"); return request(args as never); };
      await assert.rejects(submitWithWallet({ rpc, registry }, "0x1234"), /different chains/);
      assert.equal(methods.includes("eth_sendTransaction"), false);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
