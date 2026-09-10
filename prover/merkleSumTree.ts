// Poseidon2 merkle-sum tree: the shared core for every arm that is proved in
// a circuit. Pads to a fixed LEAF_CAPACITY because a circuit's array sizes are
// compile-time constants.
export type HashFn = (values: bigint[]) => bigint;

export type Entry = {
  username: string;
  balance: bigint;
  salt: bigint;
};

export type Node = {
  hash: bigint;
  sum: bigint;
};

export type MerkleSumProof = {
  rootHash: bigint;
  rootSum: bigint;
  entry: Entry;
  siblingHashes: bigint[];
  siblingSums: bigint[];
  pathIndices: number[]; // 0: left child; 1: right child
};

export function serializeProof(proof: MerkleSumProof): string {
  return JSON.stringify(
    proof,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

export function deserializeProof(json: string): MerkleSumProof {
  const parsed = JSON.parse(json);
  return {
    rootHash: BigInt(parsed.rootHash),
    rootSum: BigInt(parsed.rootSum),
    entry: {
      username: parsed.entry.username,
      balance: BigInt(parsed.entry.balance),
      salt: BigInt(parsed.entry.salt),
    },
    siblingHashes: parsed.siblingHashes.map(BigInt),
    siblingSums: parsed.siblingSums.map(BigInt),
    pathIndices: parsed.pathIndices,
  };
}

export function usernameToBigInt(username: string): bigint {
  const bytes = new TextEncoder().encode(username);
  if (bytes.length === 0) return 0n;
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return BigInt("0x" + hex);
}

function computeLeaf(entry: Entry, hash: HashFn): Node {
  return {
    hash: hash([usernameToBigInt(entry.username), entry.salt, entry.balance]),
    sum: entry.balance,
  };
}

function combineNodes(left: Node, right: Node, hash: HashFn): Node {
  const sum = left.sum + right.sum;
  if (sum < 0n) throw new Error("negative sum: a balance was negative somewhere");
  return {
    hash: hash([left.hash, left.sum, right.hash, right.sum]),
    sum,
  };
}

export const LEAF_CAPACITY = 8;

export function buildTree(
  entries: Entry[],
  hash: HashFn,
  capacity: number = LEAF_CAPACITY,
): { levels: Node[][]; root: Node; entries: Entry[] } {
  if (entries.length > capacity) {
    throw new Error(`${entries.length} entries exceeds fixed capacity ${capacity}`);
  }
  const depth = Math.log2(capacity);
  if (!Number.isInteger(depth)) throw new Error("capacity must be a power of two");

  const padded: Entry[] = [...entries];
  while (padded.length < capacity) {
    padded.push({ username: "", balance: 0n, salt: 0n });
  }

  const levels: Node[][] = [];
  levels[0] = padded.map((entry) => computeLeaf(entry, hash));

  for (let level = 1; level <= depth; level++) {
    const prev = levels[level - 1];
    const current: Node[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      current.push(combineNodes(prev[i], prev[i + 1], hash));
    }
    levels[level] = current;
  }

  return { levels, root: levels[depth][0], entries: padded };
}

export function createProof(index: number, entries: Entry[], levels: Node[][]): MerkleSumProof {
  const root = levels[levels.length - 1][0];
  const siblingHashes: bigint[] = [];
  const siblingSums: bigint[] = [];
  const pathIndices: number[] = [];

  let i = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const isRightChild = i % 2 === 1;
    const siblingIndex = isRightChild ? i - 1 : i + 1;
    const sibling = levels[level][siblingIndex];

    pathIndices.push(isRightChild ? 1 : 0);
    siblingHashes.push(sibling.hash);
    siblingSums.push(sibling.sum);

    i = Math.floor(i / 2);
  }

  return {
    rootHash: root.hash,
    rootSum: root.sum,
    entry: entries[index],
    siblingHashes,
    siblingSums,
    pathIndices,
  };
}

export function verifyProof(proof: MerkleSumProof, hash: HashFn): boolean {
  let node: Node = computeLeaf(proof.entry, hash);

  for (let level = 0; level < proof.siblingHashes.length; level++) {
    const sibling: Node = { hash: proof.siblingHashes[level], sum: proof.siblingSums[level] };
    const isRightChild = proof.pathIndices[level] === 1;

    node = isRightChild ? combineNodes(sibling, node, hash) : combineNodes(node, sibling, hash);
  }

  return node.hash === proof.rootHash && node.sum === proof.rootSum;
}

import { poseidon2Hash as poseidon2 } from "@zkpassport/poseidon2";

export const poseidon2Hash: HashFn = (values) => poseidon2(values);
