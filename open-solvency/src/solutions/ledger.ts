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
  name: "Veröffentlichter Ledger",
  description: "Der Contract berechnet Roots und Summen aus veröffentlichten, pseudonymen Teilbeträgen.",
  disclosure: "Teilbeträge sind öffentlich. Splitting und Pseudonyme garantieren keine Anonymität.",
  publication: ["Kundendaten lokal vorbereiten.", "Ledger und private Kunden-Bundles erzeugen: npm run ledger -- build <input> <neues-verzeichnis> <asset-anzahl>", "Öffentlichen Ledger prüfen: npm run ledger -- audit <verzeichnis>/ledger.json", "Ledger mit dem Company-Key über submitLedger veröffentlichen; private Bundles einzeln zustellen."],
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
    if (bundle.customerId !== account || bundle.snapshotId.toLowerCase() !== data.snapshotId.toLowerCase() || !Array.isArray(bundle.parts) || bundle.parts.length === 0) return { valid: false, message: "Bundle gehört nicht zu diesem Konto oder Snapshot." };
    const seen = new Set<number>();
    const totals = new Map<number, bigint>();
    for (const part of bundle.parts) {
      const { assetId, partIndex, proof } = part;
      if (!Number.isSafeInteger(assetId) || !Number.isSafeInteger(partIndex) || partIndex < 0 || seen.has(partIndex) || !data.roots[assetId]) return { valid: false, message: "Ungültiger oder doppelter Teilbetrag." };
      seen.add(partIndex);
      if (proof.entry.identityHash !== identity(bundle, assetId, partIndex, part.salt) || proof.rootHash !== data.roots[assetId] || proof.rootSum !== data.liabilities[assetId] || !verifyProof(proof, keccakHash)) return { valid: false, message: "Ein Teilbetrag passt nicht zum veröffentlichten Root." };
      totals.set(assetId, (totals.get(assetId) ?? 0n) + proof.entry.balance);
    }
    const valid = totals.size === expected.size && [...expected].every(([asset, amount]) => totals.get(asset) === amount);
    return { valid, message: valid ? "Alle angegebenen Teilbeträge sind im veröffentlichten Ledger enthalten." : "Die Summe der Teilbeträge stimmt nicht mit deinen Guthaben überein." };
  },
};
