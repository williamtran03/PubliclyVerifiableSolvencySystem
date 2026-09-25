import { randomBytes, randomInt } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { buildTree, createProof, verifyProof, keccakHash, checkUint, type Entry, type MerkleSumProof } from "./tree.ts";

export type Part = { assetId: number; amount: bigint };
export type Customer = { customerId: string; name: string; dateOfBirth: string; parts: Part[] };
export type Opening = { salt: Hex; assetId: number; partIndex: number; proof: MerkleSumProof };
export type CustomerBundle = { snapshotId: Hex; customerId: string; name: string; dateOfBirth: string; parts: Opening[] };
export type AssetLedger = { rootHash: bigint; totalLiabilities: bigint; entries: { identityHash: bigint; balance: bigint }[] };
export type PublicLedger = { snapshotId: Hex; assets: AssetLedger[] };
export type PublishedRoots = { snapshotId: Hex; assets: Pick<AssetLedger, "rootHash" | "totalLiabilities">[] };

export function identityCommitment(
  snapshotId: Hex,
  customer: Pick<Customer, "customerId" | "name" | "dateOfBirth">,
  assetId: number,
  partIndex: number,
  salt: Hex,
): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt) || !/^0x[0-9a-fA-F]{64}$/.test(snapshotId)) throw new Error("expected bytes32");
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
    ["solvency.split.v2", snapshotId, customer.customerId, customer.name, customer.dateOfBirth, BigInt(assetId), BigInt(partIndex), salt],
  )));
}

export function buildSplitLiabilities(customers: Customer[], snapshotId: Hex, assetCount: number) {
  const seen = new Set<string>();
  const perAsset: Entry[][] = Array.from({ length: assetCount }, () => []);
  const bundles: CustomerBundle[] = [];
  const owners = new Map<Entry, Opening>();

  for (const customer of customers) {
    if (!customer.customerId || seen.has(customer.customerId) || customer.parts.length === 0) throw new Error("missing/duplicate customer or empty parts");
    seen.add(customer.customerId);
    const parts: Opening[] = [];
    for (const [partIndex, { assetId, amount }] of customer.parts.entries()) {
      if (!Number.isInteger(assetId) || assetId < 0 || assetId >= assetCount) throw new Error(`asset ${assetId} is not in the registry`);
      checkUint(amount);
      const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
      const entry: Entry = { username: "", identityHash: identityCommitment(snapshotId, customer, assetId, partIndex, salt), balance: amount };
      const opening: Opening = { salt, assetId, partIndex, proof: undefined! };
      perAsset[assetId].push(entry);
      owners.set(entry, opening);
      parts.push(opening);
    }
    bundles.push({ snapshotId, customerId: customer.customerId, name: customer.name, dateOfBirth: customer.dateOfBirth, parts });
  }

  const assets: AssetLedger[] = perAsset.map((entries) => {
    if (entries.length === 0) return { rootHash: 0n, totalLiabilities: 0n, entries: [] };
    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const tree = buildTree(shuffled, keccakHash);
    shuffled.forEach((entry, index) => (owners.get(entry)!.proof = createProof(index, tree.entries, tree.levels)));
    return {
      rootHash: tree.root.hash,
      totalLiabilities: tree.root.sum,
      entries: shuffled.map((e) => ({ identityHash: e.identityHash!, balance: e.balance })),
    };
  });

  return { ledger: { snapshotId, assets } as PublicLedger, bundles };
}

export function verifyCustomer(bundle: CustomerBundle, expectedAmounts: Map<number, bigint>, published: PublishedRoots): boolean {
  try {
    if (bundle.snapshotId !== published.snapshotId || bundle.parts.length === 0) return false;
    const seen = new Set<number>();
    const totals = new Map<number, bigint>();
    for (const part of bundle.parts) {
      if (!Number.isSafeInteger(part.partIndex) || part.partIndex < 0 || seen.has(part.partIndex)) return false;
      seen.add(part.partIndex);
      const asset = published.assets[part.assetId];
      const p = part.proof;
      if (!asset || p.entry.identityHash !== identityCommitment(bundle.snapshotId, bundle, part.assetId, part.partIndex, part.salt) ||
          p.rootHash !== asset.rootHash || p.rootSum !== asset.totalLiabilities || !verifyProof(p, keccakHash)) return false;
      const total = (totals.get(part.assetId) ?? 0n) + p.entry.balance;
      checkUint(total);
      totals.set(part.assetId, total);
    }
    for (const assetId of new Set([...totals.keys(), ...expectedAmounts.keys()])) {
      if ((totals.get(assetId) ?? 0n) !== (expectedAmounts.get(assetId) ?? 0n)) return false;
    }
    return true;
  } catch { return false; }
}

export function verifyPublicLedger(ledger: PublicLedger): boolean {
  try {
    return ledger.assets.every((asset) => {
      if (asset.entries.length === 0) return asset.rootHash === 0n && asset.totalLiabilities === 0n;
      const { root } = buildTree(asset.entries.map((e) => ({ ...e, username: "" })), keccakHash);
      return root.hash === asset.rootHash && root.sum === asset.totalLiabilities;
    });
  } catch { return false; }
}
