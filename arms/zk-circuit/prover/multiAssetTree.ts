import { poseidon2Hash, usernameToBigInt, LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";

export const NUM_ASSETS = 3;
export const MAX_U64 = (1n << 64n) - 1n;

export type Holding = {
  username: string;
  salt: bigint;
  assetId: number;
  amount: bigint;
};

export type Node = {
  hash: bigint;
  sum: bigint;
};

export type MultiAssetProof = {
  rootHash: bigint;
  rootSum: bigint;
  holding: Holding;
  siblingHashes: bigint[];
  siblingSums: bigint[];
  pathIndices: number[]; // 0: left child; 1: right child
};

export const PADDING: Holding = { username: "", salt: 0n, assetId: 0, amount: 0n };

// Columns: username,salt,assetId,amount with a header row.
export function parseHoldingsCsv(csv: string): Holding[] {
  const [, ...rows] = csv.trim().split("\n");
  return rows.map((row) => {
    const [username, salt, assetId, amount] = row.split(",");
    const holding = {
      username: username.trim(),
      salt: BigInt(salt.trim()),
      assetId: Number(assetId.trim()),
      amount: BigInt(amount.trim()),
    };
    if (!Number.isInteger(holding.assetId) || holding.assetId < 0 || holding.assetId >= NUM_ASSETS) {
      throw new Error(`assetId ${holding.assetId} is outside the price table`);
    }
    if (holding.amount < 0n || holding.amount > MAX_U64) {
      throw new Error(`amount ${holding.amount} does not fit in u64`);
    }
    return holding;
  });
}

function priceOf(assetId: number, prices: bigint[]): bigint {
  if (!Number.isInteger(assetId) || assetId < 0 || assetId >= NUM_ASSETS) {
    throw new Error(`assetId ${assetId} is outside the price table`);
  }
  return prices[assetId];
}

export function computeLeaf(holding: Holding, prices: bigint[]): Node {
  if (holding.amount < 0n || holding.amount > MAX_U64) {
    throw new Error(`amount ${holding.amount} does not fit in u64`);
  }
  return {
    hash: poseidon2Hash([
      usernameToBigInt(holding.username),
      holding.salt,
      BigInt(holding.assetId),
      holding.amount,
    ]),
    sum: holding.amount * priceOf(holding.assetId, prices),
  };
}

function combineNodes(left: Node, right: Node): Node {
  return {
    hash: poseidon2Hash([left.hash, left.sum, right.hash, right.sum]),
    sum: left.sum + right.sum,
  };
}

export function buildTree(
  holdings: Holding[],
  prices: bigint[],
  capacity: number = LEAF_CAPACITY,
): { levels: Node[][]; root: Node; holdings: Holding[] } {
  if (prices.length !== NUM_ASSETS) throw new Error(`expected ${NUM_ASSETS} prices`);
  if (holdings.length > capacity) {
    throw new Error(`${holdings.length} holdings exceeds capacity ${capacity}`);
  }
  const depth = Math.log2(capacity);
  if (!Number.isInteger(depth)) throw new Error("capacity must be a power of two");

  const padded = [...holdings];
  while (padded.length < capacity) padded.push(PADDING);

  const levels: Node[][] = [padded.map((holding) => computeLeaf(holding, prices))];
  for (let level = 1; level <= depth; level++) {
    const previous = levels[level - 1];
    const current: Node[] = [];
    for (let i = 0; i < previous.length; i += 2) {
      current.push(combineNodes(previous[i], previous[i + 1]));
    }
    levels[level] = current;
  }

  return { levels, root: levels[depth][0], holdings: padded };
}

export function createProof(index: number, holdings: Holding[], levels: Node[][]): MultiAssetProof {
  const root = levels[levels.length - 1][0];
  const siblingHashes: bigint[] = [];
  const siblingSums: bigint[] = [];
  const pathIndices: number[] = [];

  let i = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const isRightChild = i % 2 === 1;
    const sibling = levels[level][isRightChild ? i - 1 : i + 1];
    pathIndices.push(isRightChild ? 1 : 0);
    siblingHashes.push(sibling.hash);
    siblingSums.push(sibling.sum);
    i = Math.floor(i / 2);
  }

  return {
    rootHash: root.hash,
    rootSum: root.sum,
    holding: holdings[index],
    siblingHashes,
    siblingSums,
    pathIndices,
  };
}

export function verifyProof(proof: MultiAssetProof, prices: bigint[]): boolean {
  try {
    let node = computeLeaf(proof.holding, prices);
    for (let level = 0; level < proof.siblingHashes.length; level++) {
      const sibling: Node = { hash: proof.siblingHashes[level], sum: proof.siblingSums[level] };
      node = proof.pathIndices[level] === 1 ? combineNodes(sibling, node) : combineNodes(node, sibling);
    }
    return node.hash === proof.rootHash && node.sum === proof.rootSum;
  } catch {
    return false;
  }
}

export type CustomerBundle = {
  username: string;
  prices: string[];
  parts: MultiAssetProof[];
};

export function serializeBundle(bundle: CustomerBundle): string {
  return JSON.stringify(bundle, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}

export function deserializeBundle(json: string): CustomerBundle {
  const parsed = JSON.parse(json);
  return {
    username: parsed.username,
    prices: parsed.prices,
    parts: parsed.parts.map((part: any) => ({
      rootHash: BigInt(part.rootHash),
      rootSum: BigInt(part.rootSum),
      holding: {
        username: part.holding.username,
        salt: BigInt(part.holding.salt),
        assetId: Number(part.holding.assetId),
        amount: BigInt(part.holding.amount),
      },
      siblingHashes: part.siblingHashes.map(BigInt),
      siblingSums: part.siblingSums.map(BigInt),
      pathIndices: part.pathIndices,
    })),
  };
}

// The customer supplies their own expected per-asset totals; the bundle is never
// trusted to say what they should hold.
export function verifyBundle(
  bundle: CustomerBundle,
  expectedAmounts: Map<number, bigint>,
  rootHash: bigint,
  rootSum: bigint,
): boolean {
  if (bundle.parts.length === 0) return false;
  const prices = bundle.prices.map(BigInt);
  if (prices.length !== NUM_ASSETS) return false;

  const seen = new Set<string>();
  const totals = new Map<number, bigint>();

  for (const part of bundle.parts) {
    if (part.holding.username !== bundle.username) return false;
    if (part.rootHash !== rootHash || part.rootSum !== rootSum) return false;

    const position = part.pathIndices.join("");
    if (seen.has(position)) return false;
    seen.add(position);

    if (!verifyProof(part, prices)) return false;
    totals.set(part.holding.assetId, (totals.get(part.holding.assetId) ?? 0n) + part.holding.amount);
  }

  if (totals.size !== expectedAmounts.size) return false;
  for (const [assetId, expected] of expectedAmounts) {
    if (totals.get(assetId) !== expected) return false;
  }
  return true;
}
