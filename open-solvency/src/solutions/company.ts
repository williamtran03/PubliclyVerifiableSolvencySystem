import { buildTree, keccakHash } from "@arms/published-ledger/prover/tree.ts";
import type { Snapshot, SolutionId } from "../types.ts";

export function inspectArtifact(solution: SolutionId, snapshot: Snapshot, text: string): string {
  const raw = JSON.parse(text);
  if (solution === "zk-circuit") {
    const data = snapshot.data as { root: bigint; context: bigint };
    if (!Array.isArray(raw.floors) || raw.floors.length !== snapshot.assets.length) throw new Error("Invalid ZK epoch artifact.");
    if (BigInt(raw.rootHash) !== data.root || BigInt(raw.context) !== data.context || raw.floors.some((v: string, i: number) => BigInt(v) !== snapshot.assets[i].floor)) throw new Error("The artifact does not match the on-chain snapshot.");
    return "ZK root, context, and reserve floors match the published epoch.";
  }
  if (solution === "published-ledger") {
    const data = snapshot.data as { snapshotId: string; roots: bigint[]; liabilities: bigint[] };
    if (raw.snapshotId?.toLowerCase() !== data.snapshotId.toLowerCase() || !Array.isArray(raw.assets) || raw.assets.length !== data.roots.length) throw new Error("Snapshot ID or asset count does not match.");
    for (const [i, asset] of raw.assets.entries()) {
      const entries = asset.entries.map((entry: { identityHash: string; balance: string }) => ({ username: "", identityHash: BigInt(entry.identityHash), balance: BigInt(entry.balance) }));
      const root = entries.length ? buildTree(entries, keccakHash).root : { hash: 0n, sum: 0n };
      if (root.hash !== data.roots[i] || root.sum !== data.liabilities[i] || root.hash !== BigInt(asset.rootHash) || root.sum !== BigInt(asset.totalLiabilities)) throw new Error(`Asset ${i}: ledger root or total does not match.`);
    }
    return "All public ledger entries produce the published roots and totals.";
  }
  const data = snapshot.data as { balanceCommitment: { x: bigint; y: bigint }; identityCommitment: { x: bigint; y: bigint }; totalLiabilities: bigint };
  if (BigInt(raw.epochId) !== snapshot.epoch || BigInt(raw.totalLiabilities) !== data.totalLiabilities || BigInt(raw.balanceCommitment.x) !== data.balanceCommitment.x || BigInt(raw.balanceCommitment.y) !== data.balanceCommitment.y || BigInt(raw.identityCommitment.x) !== data.identityCommitment.x || BigInt(raw.identityCommitment.y) !== data.identityCommitment.y) throw new Error("The KZG artifact does not match the on-chain snapshot.");
  return "KZG epoch, commitments, and total liabilities match the registry.";
}
