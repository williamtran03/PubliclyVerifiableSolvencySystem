import { randomBytes, randomInt } from "node:crypto";
import { buildTree, createProof, poseidon2Hash, usernameToBigInt, LEAF_CAPACITY, type Entry } from "../merkleSumTree.ts";
import { FIELD, MAX_BALANCE, splitSalt, type Identity, type SplitBundle } from "./splitProof.ts";
import type { Hex } from "viem";

export type SplitCustomer = Identity & { amounts: bigint[] };
export function buildSplitLiabilities(customers: SplitCustomer[], snapshotId: Hex) {
  if (customers.length === 0) throw new Error("empty ledger");
  const entries: Entry[] = [], bundles: SplitBundle[] = [];
  const seen = new Set<string>();
  for (const customer of customers) {
    if (!customer.customerId || seen.has(customer.customerId) || usernameToBigInt(customer.customerId) >= FIELD) throw new Error("invalid or duplicate customer ID");
    seen.add(customer.customerId);
    if (!customer.amounts.length) throw new Error("empty customer parts");
    const bundle: SplitBundle = { scheme: "poseidon2-split-v1", snapshotId, customerId: customer.customerId, name: customer.name, dateOfBirth: customer.dateOfBirth, parts: [] };
    for (const [partIndex, balance] of customer.amounts.entries()) {
      if (typeof balance !== "bigint" || balance < 0n || balance > MAX_BALANCE) throw new Error("part outside u64 range");
      if (entries.length >= LEAF_CAPACITY) throw new Error("split ledger exceeds eight circuit slots");
      const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
      entries.push({ username: customer.customerId, salt: splitSalt(snapshotId, customer, partIndex, nonce), balance });
      bundle.parts.push({ partIndex, nonce, proof: undefined! });
    }
    bundles.push(bundle);
  }
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const positions = new Map(shuffled.map((entry, i) => [entry, i]));
  const tree = buildTree(shuffled, poseidon2Hash);
  let index = 0;
  for (const bundle of bundles) for (const part of bundle.parts) part.proof = createProof(positions.get(entries[index++])!, tree.entries, tree.levels);
  const witness = { usernames: tree.entries.map(e => usernameToBigInt(e.username).toString()), salts: tree.entries.map(e => e.salt.toString()), balances: tree.entries.map(e => e.balance.toString()) };
  const proverToml = Object.entries(witness).map(([key, values]) => `${key} = [${values.map(v => `"${v}"`).join(", ")}]`).join("\n") + "\n";
  return { epoch: { rootHash: tree.root.hash, totalLiabilities: tree.root.sum }, bundles, witness, proverToml };
}
