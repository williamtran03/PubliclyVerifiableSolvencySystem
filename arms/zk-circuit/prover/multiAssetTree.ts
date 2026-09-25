import { encodeAbiParameters, keccak256 } from "viem";
import { poseidon2Hash, usernameToBigInt, LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";

export const NUM_ASSETS = 3;
export const MAX_U64 = (1n << 64n) - 1n;
export const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = Math.log2(LEAF_CAPACITY);

export type Holding = {
  username: string;
  salt: bigint;
  assetId: number;
  amount: bigint;
};

export type InclusionProof = {
  holding: Holding;
  siblings: bigint[];
  pathIndices: number[];
};

export type CustomerBundle = {
  username: string;
  parts: InclusionProof[];
};

export const PADDING: Holding = { username: "", salt: 0n, assetId: 0, amount: 0n };

export function epochContext(chainId: bigint, registry: `0x${string}`, epochId: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [chainId, registry, epochId],
  );
  return BigInt(keccak256(encoded)) % FIELD_ORDER;
}

export function parseHoldingsCsv(csv: string): Holding[] {
  const [, ...rows] = csv.trim().split("\n");
  const salts = new Map<string, bigint>();
  return rows.map((row) => {
    const [username, salt, assetId, amount] = row.split(",");
    const holding = {
      username: username.trim(),
      salt: BigInt(salt.trim()),
      assetId: Number(assetId.trim()),
      amount: BigInt(amount.trim()),
    };
    usernameToBigInt(holding.username);
    if (!Number.isInteger(holding.assetId) || holding.assetId < 0 || holding.assetId >= NUM_ASSETS) {
      throw new Error(`assetId ${holding.assetId} is not tracked by the registry`);
    }
    if (holding.amount < 0n || holding.amount > MAX_U64) {
      throw new Error(`amount ${holding.amount} does not fit in u64`);
    }
    if (salts.has(holding.username) && salts.get(holding.username) !== holding.salt) {
      throw new Error(`${holding.username} has two salts; a customer keeps one`);
    }
    salts.set(holding.username, holding.salt);
    return holding;
  });
}

export function computeLeaf(holding: Holding): bigint {
  if (!Number.isInteger(holding.assetId) || holding.assetId < 0 || holding.assetId >= NUM_ASSETS) {
    throw new Error(`assetId ${holding.assetId} is not tracked by the registry`);
  }
  if (holding.amount < 0n || holding.amount > MAX_U64) {
    throw new Error(`amount ${holding.amount} does not fit in u64`);
  }
  return poseidon2Hash([usernameToBigInt(holding.username), holding.salt, BigInt(holding.assetId), holding.amount]);
}

const combine = (left: bigint, right: bigint) => poseidon2Hash([left, right]);

export function bindRoot(treeRoot: bigint, context: bigint): bigint {
  return poseidon2Hash([treeRoot, context]);
}

export function liabilitiesOf(holdings: Holding[]): bigint[] {
  const totals = new Array<bigint>(NUM_ASSETS).fill(0n);
  for (const h of holdings) totals[h.assetId] += h.amount;
  return totals;
}

export function buildTree(holdings: Holding[]): { levels: bigint[][]; treeRoot: bigint; holdings: Holding[] } {
  if (holdings.length > LEAF_CAPACITY) {
    throw new Error(`${holdings.length} holdings exceeds capacity ${LEAF_CAPACITY}`);
  }
  const padded = [...holdings];
  while (padded.length < LEAF_CAPACITY) padded.push(PADDING);

  const levels: bigint[][] = [padded.map(computeLeaf)];
  for (let level = 1; level <= DEPTH; level++) {
    const previous = levels[level - 1];
    const current: bigint[] = [];
    for (let i = 0; i < previous.length; i += 2) current.push(combine(previous[i], previous[i + 1]));
    levels[level] = current;
  }
  return { levels, treeRoot: levels[DEPTH][0], holdings: padded };
}

export function createProof(index: number, holdings: Holding[], levels: bigint[][]): InclusionProof {
  if (!Number.isSafeInteger(index) || index < 0 || index >= holdings.length) {
    throw new Error(`index ${index} is outside the tree`);
  }
  const siblings: bigint[] = [];
  const pathIndices: number[] = [];
  let i = index;
  for (let level = 0; level < DEPTH; level++) {
    const isRightChild = i % 2 === 1;
    siblings.push(levels[level][isRightChild ? i - 1 : i + 1]);
    pathIndices.push(isRightChild ? 1 : 0);
    i = Math.floor(i / 2);
  }
  return { holding: holdings[index], siblings, pathIndices };
}

export function createBundle(username: string, holdings: Holding[], levels: bigint[][]): CustomerBundle {
  const parts = holdings.flatMap((h, index) => (h.username === username ? [createProof(index, holdings, levels)] : []));
  return { username, parts };
}

export function rootOf(proof: InclusionProof): bigint | null {
  try {
    if (
      proof.siblings.length !== DEPTH ||
      proof.pathIndices.length !== DEPTH ||
      proof.pathIndices.some((i) => i !== 0 && i !== 1)
    ) {
      return null;
    }
    let node = computeLeaf(proof.holding);
    for (let level = 0; level < DEPTH; level++) {
      node = proof.pathIndices[level] === 1 ? combine(proof.siblings[level], node) : combine(node, proof.siblings[level]);
    }
    return node;
  } catch {
    return null;
  }
}

export function serializeBundle(bundle: CustomerBundle): string {
  return JSON.stringify(bundle, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}

export function deserializeBundle(json: string): CustomerBundle {
  const parsed = JSON.parse(json);
  return {
    username: parsed.username,
    parts: parsed.parts.map((part: any) => ({
      holding: {
        username: part.holding.username,
        salt: BigInt(part.holding.salt),
        assetId: Number(part.holding.assetId),
        amount: BigInt(part.holding.amount),
      },
      siblings: part.siblings.map(BigInt),
      pathIndices: part.pathIndices,
    })),
  };
}

export type Customer = {
  username: string;
  salt: bigint;
  expectedAmounts: Map<number, bigint>;
};

export function verifyBundle(bundle: CustomerBundle, customer: Customer, publishedRoot: bigint, context: bigint): boolean {
  if (bundle.parts.length === 0) return false;

  const positions = new Set<string>();
  const totals = new Map<number, bigint>();
  for (const part of bundle.parts) {
    if (part.holding.username !== customer.username || part.holding.salt !== customer.salt) return false;

    const treeRoot = rootOf(part);
    if (treeRoot === null || bindRoot(treeRoot, context) !== publishedRoot) return false;

    const position = part.pathIndices.join("");
    if (positions.has(position)) return false;
    positions.add(position);

    totals.set(part.holding.assetId, (totals.get(part.holding.assetId) ?? 0n) + part.holding.amount);
  }

  for (const assetId of new Set([...totals.keys(), ...customer.expectedAmounts.keys()])) {
    if ((totals.get(assetId) ?? 0n) !== (customer.expectedAmounts.get(assetId) ?? 0n)) return false;
  }
  return true;
}
