import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { deserializeProof, verifyProof, poseidon2Hash, type MerkleSumProof } from "../merkleSumTree.ts";

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MAX_BALANCE = (1n << 64n) - 1n;
export type Identity = { customerId: string; name: string; dateOfBirth: string };
export type SplitBundle = Identity & { scheme: "poseidon2-split-v1"; snapshotId: Hex; parts: { partIndex: number; nonce: Hex; proof: MerkleSumProof }[] };

// Commit the identity opening into the existing circuit's salt field. The circuit
// proves the tree arithmetic; the customer, not the circuit, checks this opening.
export function splitSalt(snapshotId: Hex, identity: Identity, partIndex: number, nonce: Hex): bigint {
  if (![snapshotId, nonce].every(v => /^0x[0-9a-fA-F]{64}$/.test(v))) throw new Error("expected bytes32 snapshot and nonce");
  if (!Number.isSafeInteger(partIndex) || partIndex < 0) throw new Error("invalid part index");
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "bytes32" }],
    ["solvency.poseidon2.split.v1", snapshotId, identity.customerId, identity.name, identity.dateOfBirth, BigInt(partIndex), nonce],
  ))) % FIELD;
}

export function deserializeSplitBundle(text: string): SplitBundle {
  if (text.length > 262144) throw new Error("bundle too large");
  const b = JSON.parse(text);
  if (b.scheme !== "poseidon2-split-v1" || !Array.isArray(b.parts) || b.parts.length < 1 || b.parts.length > 8) throw new Error("invalid split bundle");
  return { ...b, parts: b.parts.map((p: any) => ({ ...p, proof: deserializeProof(JSON.stringify(p.proof)) })) };
}

export function verifySplitBundle(bundle: SplitBundle, expectedId: string, expectedBalance: bigint, rootHash: bigint, totalLiabilities: bigint): boolean {
  try {
    if (bundle.scheme !== "poseidon2-split-v1" || bundle.customerId !== expectedId || !expectedId || expectedBalance < 0n || expectedBalance > MAX_BALANCE * 8n || bundle.parts.length < 1 || bundle.parts.length > 8) return false;
    const indices = new Set<number>();
    const leaves = new Set<string>();
    let sum = 0n;
    for (const part of bundle.parts) {
      if (indices.has(part.partIndex)) return false;
      indices.add(part.partIndex);
      const p = part.proof;
      if (p.pathIndices.length !== 3 || p.siblingHashes.length !== 3 || p.siblingSums.length !== 3 || p.pathIndices.some(i => i !== 0 && i !== 1)) return false;
      const position = p.pathIndices.join("");
      if (leaves.has(position)) return false;
      leaves.add(position);
      if (p.entry.username !== expectedId || p.entry.balance < 0n || p.entry.balance > MAX_BALANCE || p.entry.salt !== splitSalt(bundle.snapshotId, bundle, part.partIndex, part.nonce)) return false;
      if (p.siblingHashes.some(h => h < 0n || h >= FIELD) || p.siblingSums.some((s, i) => s < 0n || s > MAX_BALANCE * (1n << BigInt(i)))) return false;
      if (p.rootHash !== rootHash || p.rootSum !== totalLiabilities || !verifyProof(p, poseidon2Hash)) return false;
      sum += p.entry.balance;
    }
    return sum === expectedBalance;
  } catch { return false; }
}
