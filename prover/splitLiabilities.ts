import { randomBytes, randomInt } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { buildTree, createProof, verifyProof, keccakHash, checkUint, type Entry, type MerkleSumProof } from "./merkleSumTree.ts";

export type Customer = { customerId: string; name: string; dateOfBirth: string; amounts: bigint[] };
export type Opening = { salt: Hex; partIndex: number; proof: MerkleSumProof };
export type CustomerBundle = { snapshotId: Hex; customerId: string; name: string; dateOfBirth: string; parts: Opening[] };
export type PublicLedger = { snapshotId: Hex; rootHash: bigint; totalLiabilities: bigint; entries: { identityHash: bigint; balance: bigint }[] };

// ABI encoding keeps variable-length fields unambiguous. Keep this opening private.
export function identityCommitment(snapshotId: Hex, customer: Pick<Customer, "customerId" | "name" | "dateOfBirth">, partIndex: number, salt: Hex): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt) || !/^0x[0-9a-fA-F]{64}$/.test(snapshotId)) throw new Error("expected bytes32");
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "bytes32" }],
    ["solvency.split.v1", snapshotId, customer.customerId, customer.name, customer.dateOfBirth, BigInt(partIndex), salt],
  )));
}

function validSnapshot(snapshotId: unknown): snapshotId is Hex {
  return typeof snapshotId === "string" && /^0x[0-9a-fA-F]{64}$/.test(snapshotId) && BigInt(snapshotId) !== 0n;
}

export function buildSplitLiabilities(customers: Customer[], snapshotId: Hex) {
  if (!validSnapshot(snapshotId)) throw new Error("invalid snapshot ID");
  if (customers.reduce((count, customer) => count + customer.amounts.length, 0) > 256) throw new Error("contract supports at most 256 parts");
  const seen = new Set<string>();
  const entries: Entry[] = [];
  const bundles: CustomerBundle[] = [];
  for (const customer of customers) {
    if (!customer.customerId || seen.has(customer.customerId) || customer.amounts.length === 0) throw new Error("missing/duplicate customer or empty parts");
    seen.add(customer.customerId);
    const parts: Opening[] = [];
    for (const [partIndex, balance] of customer.amounts.entries()) {
      checkUint(balance);
      const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
      entries.push({ username: "", identityHash: identityCommitment(snapshotId, customer, partIndex, salt), balance });
      parts.push({ salt, partIndex, proof: undefined! });
    }
    bundles.push({ snapshotId, customerId: customer.customerId, name: customer.name, dateOfBirth: customer.dateOfBirth, parts });
  }
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const positions = new Map(shuffled.map((entry, i) => [entry, i]));
  const tree = buildTree(shuffled, keccakHash);
  let index = 0;
  for (const bundle of bundles) for (const part of bundle.parts) part.proof = createProof(positions.get(entries[index++])!, tree.entries, tree.levels);
  const ledger: PublicLedger = { snapshotId, rootHash: tree.root.hash, totalLiabilities: tree.root.sum,
    entries: shuffled.map(e => ({ identityHash: e.identityHash!, balance: e.balance })) };
  return { ledger, bundles };
}

// expectedBalance must come from the customer's own records, not the proof file.
export function verifyCustomer(bundle: CustomerBundle, expectedBalance: bigint, expected: Pick<PublicLedger, "snapshotId" | "rootHash" | "totalLiabilities">): boolean {
  try {
    checkUint(expectedBalance);
    if (bundle.snapshotId !== expected.snapshotId || bundle.parts.length === 0) return false;
    const seen = new Set<number>();
    let total = 0n;
    for (const part of bundle.parts) {
      if (!Number.isSafeInteger(part.partIndex) || part.partIndex < 0 || seen.has(part.partIndex)) return false;
      seen.add(part.partIndex);
      const p = part.proof;
      if (p.entry.identityHash !== identityCommitment(bundle.snapshotId, bundle, part.partIndex, part.salt) ||
          p.rootHash !== expected.rootHash || p.rootSum !== expected.totalLiabilities || !verifyProof(p, keccakHash)) return false;
      total += p.entry.balance;
      checkUint(total);
    }
    return total === expectedBalance;
  } catch { return false; }
}

export function verifyPublicLedger(ledger: PublicLedger): boolean {
  try {
    if (!validSnapshot(ledger.snapshotId) || !Array.isArray(ledger.entries) || ledger.entries.length === 0 || ledger.entries.length > 256) return false;
    const { root } = buildTree(ledger.entries.map(e => ({ ...e, username: "" })), keccakHash);
    return root.hash === ledger.rootHash && root.sum === ledger.totalLiabilities;
  } catch { return false; }
}
