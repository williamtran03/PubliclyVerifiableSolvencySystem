import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, type Hex } from "viem";
import { buildTree, verifyProof, keccakHash, type MerkleSumProof } from "@arms/published-ledger/prover/tree.ts";
import { assertEpoch, client, readFreshness, tokenMetadata } from "./common.ts";
import type { PublicLedgerAsset, Snapshot, Solution } from "../types.ts";

const abi = parseAbi([
  "struct Epoch { bytes32 snapshotId; uint256[] rootHashes; uint256[] liabilities; uint256[] reserves; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256) view returns (Epoch)",
  "function assets(uint256) view returns (address)",
  "event LedgerSubmitted(uint256 indexed epochId, bytes32 indexed snapshotId, uint256[] rootHashes, uint256[] liabilities, uint256[] reserves)",
  "function submitLedger(bytes32 snapshotId, uint256[][] identities, uint256[][] amounts)",
]);

type Bundle = { snapshotId: Hex; customerId: string; name: string; dateOfBirth: string; parts: {
  salt: Hex; assetId: number; partIndex: number; proof: MerkleSumProof;
}[] };

function parseBundle(text: string): Bundle {
  const numeric = new Set(["balance", "identityHash", "rootHash", "rootSum"]);
  return JSON.parse(text, (key, value) => {
    if (numeric.has(key)) return BigInt(value);
    if (key === "siblingHashes" || key === "siblingSums") return value.map(BigInt);
    return value;
  });
}

function identity(bundle: Bundle, assetId: number, partIndex: number, salt: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
    ["solvency.split.v2", bundle.snapshotId, bundle.customerId, bundle.name, bundle.dateOfBirth, BigInt(assetId), BigInt(partIndex), salt],
  )));
}

async function publicLedger(c: ReturnType<typeof client>, registry: `0x${string}`, epoch: bigint, snapshotId: Hex, roots: readonly bigint[], liabilities: readonly bigint[], blockNumber: bigint): Promise<PublicLedgerAsset[] | undefined> {
  const logs = await c.getLogs({ address: registry, fromBlock: 0n, toBlock: blockNumber, event: {
    type: "event",
    name: "LedgerSubmitted",
    inputs: [
      { indexed: true, name: "epochId", type: "uint256" },
      { indexed: true, name: "snapshotId", type: "bytes32" },
      { indexed: false, name: "rootHashes", type: "uint256[]" },
      { indexed: false, name: "liabilities", type: "uint256[]" },
      { indexed: false, name: "reserves", type: "uint256[]" },
    ],
  }, args: { epochId: epoch, snapshotId } });
  const log = logs[0];
  if (!log?.transactionHash) return undefined;
  const transaction = await c.getTransaction({ hash: log.transactionHash });
  if (transaction.to?.toLowerCase() !== registry.toLowerCase()) return undefined;
  const decoded = decodeFunctionData({ abi, data: transaction.input });
  if (decoded.functionName !== "submitLedger") return undefined;
  const [calledSnapshot, identities, amounts] = decoded.args as readonly [Hex, readonly (readonly bigint[])[], readonly (readonly bigint[])[]];
  if (calledSnapshot.toLowerCase() !== snapshotId.toLowerCase() || identities.length !== roots.length || amounts.length !== roots.length) return undefined;
  const assets = roots.map((rootHash, assetId) => ({
    rootHash,
    total: liabilities[assetId],
    entries: identities[assetId].map((identity, index) => ({ identity, amount: amounts[assetId][index] })),
  }));
  validateLedger(assets, roots, liabilities);
  return assets;
}

function validateLedger(assets: PublicLedgerAsset[], roots: readonly bigint[], liabilities: readonly bigint[]) {
  if (assets.length !== roots.length) throw new Error("The asset count does not match this snapshot.");
  for (const [i, asset] of assets.entries()) {
    if (!Array.isArray(asset.entries) || asset.entries.length > 256) throw new Error("Invalid public ledger entry count.");
    const root = asset.entries.length ? buildTree(asset.entries.map(entry => ({ username: "", identityHash: entry.identity, balance: entry.amount })), keccakHash).root : { hash: 0n, sum: 0n };
    if (asset.rootHash !== roots[i] || asset.total !== liabilities[i] || root.hash !== roots[i] || root.sum !== liabilities[i]) throw new Error("The public ledger does not match this snapshot’s roots and totals.");
  }
}

export function readPublicLedgerArtifact(snapshot: Snapshot, text: string): PublicLedgerAsset[] {
  const raw = JSON.parse(text);
  const data = snapshot.data as { snapshotId: Hex; roots: bigint[]; liabilities: bigint[] };
  if (typeof raw.snapshotId !== "string" || raw.snapshotId.toLowerCase() !== data.snapshotId.toLowerCase() || !Array.isArray(raw.assets)) throw new Error("The public ledger does not belong to this snapshot.");
  const integer = (value: unknown): bigint => {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("Public ledger integers must be decimal strings.");
    return BigInt(value);
  };
  const assets = raw.assets.map((asset: { rootHash: string; totalLiabilities: string; entries: { identityHash: string; balance: string }[] }) => {
    if (!Array.isArray(asset.entries) || asset.entries.length > 256) throw new Error("Invalid public ledger entry count.");
    return { rootHash: integer(asset.rootHash), total: integer(asset.totalLiabilities), entries: asset.entries.map(entry => ({ identity: integer(entry.identityHash), amount: integer(entry.balance) })) };
  });
  validateLedger(assets, data.roots, data.liabilities);
  return assets;
}

export const ledger: Solution = {
  id: "published-ledger",
  name: "Merkle-Sum Tree",
  description: "One Merkle-sum tree per asset; the contract recomputes roots and totals from the public ledger.",
  disclosure: "Customers verify their private Merkle paths locally. Part balances are public; splitting and pseudonyms do not guarantee anonymity.",
  publication: ["Prepare customer data locally.", "Build the ledger and private customer bundles: npm run ledger -- build <input> <new-directory> <asset-count>", "Audit the public ledger: npm run ledger -- audit <directory>/ledger.json", "Publish through submitLedger with the company key; deliver each private bundle separately."],
  async read(connection) {
    const c = client(connection);
    const blockNumber = await c.getBlockNumber({ cacheTime: 0 });
    const epoch = assertEpoch(await c.readContract({ address: connection.registry, abi, functionName: "epochCount", blockNumber }));
    const value = await c.readContract({ address: connection.registry, abi, functionName: "getEpoch", args: [epoch], blockNumber });
    const assets = await Promise.all(value.reserves.map(async (reserves, i) => {
      const token = await c.readContract({ address: connection.registry, abi, functionName: "assets", args: [BigInt(i)], blockNumber });
      return { ...await tokenMetadata(c, token, blockNumber), reserves, liabilities: value.liabilities[i] };
    }));
    return {
      epoch, timestamp: value.timestamp, commitment: value.snapshotId,
      assets,
      freshness: await readFreshness(c, connection.registry, blockNumber),
      publicLedger: await publicLedger(c, connection.registry, epoch, value.snapshotId, value.rootHashes, value.liabilities, blockNumber).catch(() => undefined),
      data: { snapshotId: value.snapshotId, roots: value.rootHashes, liabilities: value.liabilities },
    };
  },
  async verify(_connection, snapshot, file, account, expected) {
    const bundle = parseBundle(file);
    const data = snapshot.data as { snapshotId: Hex; roots: bigint[]; liabilities: bigint[] };
    if (bundle.customerId !== account || bundle.snapshotId.toLowerCase() !== data.snapshotId.toLowerCase() || !Array.isArray(bundle.parts) || bundle.parts.length === 0) return { valid: false, message: "The bundle does not belong to this account or snapshot." };
    const seen = new Set<number>();
    const totals = new Map<number, bigint>();
    for (const part of bundle.parts) {
      const { assetId, partIndex, proof } = part;
      if (!Number.isSafeInteger(assetId) || !Number.isSafeInteger(partIndex) || partIndex < 0 || seen.has(partIndex) || !data.roots[assetId]) return { valid: false, message: "Invalid or duplicate balance part." };
      seen.add(partIndex);
      if (proof.entry.identityHash !== identity(bundle, assetId, partIndex, part.salt) || proof.rootHash !== data.roots[assetId] || proof.rootSum !== data.liabilities[assetId] || !verifyProof(proof, keccakHash)) return { valid: false, message: "A balance part does not match the published root." };
      totals.set(assetId, (totals.get(assetId) ?? 0n) + proof.entry.balance);
    }
    const valid = [...new Set([...totals.keys(), ...expected.keys()])].every((asset) => (totals.get(asset) ?? 0n) === (expected.get(asset) ?? 0n));
    return { valid, message: valid ? "All entered balance parts are included in the published ledger." : "The sum of the balance parts does not match your balances." };
  },
};
