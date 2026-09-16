import { encodeAbiParameters, keccak256, parseAbi, type Hex } from "viem";
import { verifyProof, keccakHash, type MerkleSumProof } from "@arms/published-ledger/prover/tree.ts";
import { assertEpoch, client } from "./common.ts";
import type { Solution } from "../types.ts";

const abi = parseAbi([
  "struct Epoch { bytes32 snapshotId; uint256[] rootHashes; uint256[] liabilities; uint256[] reserves; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function latestEpoch() view returns (Epoch)",
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

export const ledger: Solution = {
  id: "published-ledger",
  name: "Merkle-Sum Tree",
  description: "One Merkle-sum tree per asset; the contract recomputes roots and totals from the public ledger.",
  disclosure: "Customers verify their private Merkle paths locally. Part balances are public; splitting and pseudonyms do not guarantee anonymity.",
  publication: ["Prepare customer data locally.", "Build the ledger and private customer bundles: npm run ledger -- build <input> <new-directory> <asset-count>", "Audit the public ledger: npm run ledger -- audit <directory>/ledger.json", "Publish through submitLedger with the company key; deliver each private bundle separately."],
  async read(connection) {
    const c = client(connection);
    const epoch = assertEpoch(await c.readContract({ address: connection.registry, abi, functionName: "epochCount" }));
    const value = await c.readContract({ address: connection.registry, abi, functionName: "latestEpoch" });
    return {
      epoch, timestamp: value.timestamp, commitment: value.snapshotId,
      assets: value.reserves.map((reserves, i) => ({ label: `Asset ${i}`, reserves, liabilities: value.liabilities[i] })),
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
    const valid = totals.size === expected.size && [...expected].every(([asset, amount]) => totals.get(asset) === amount);
    return { valid, message: valid ? "All entered balance parts are included in the published ledger." : "The sum of the balance parts does not match your balances." };
  },
};
