export type HashFn = (values: bigint[]) => bigint;

export type Entry = {
  username: string;
  balance: bigint;
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
    entry: { username: parsed.entry.username, balance: BigInt(parsed.entry.balance) },
    siblingHashes: parsed.siblingHashes.map(BigInt),
    siblingSums: parsed.siblingSums.map(BigInt),
    pathIndices: parsed.pathIndices,
  };
}

function usernameToBigInt(username: string): bigint {
  const bytes = new TextEncoder().encode(username);
  if (bytes.length === 0) return 0n;
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function computeLeaf(entry: Entry, hash: HashFn): Node {
  return {
    hash: hash([usernameToBigInt(entry.username), entry.balance]),
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

export function buildTree(
  entries: Entry[],
  hash: HashFn,
): { levels: Node[][]; root: Node; entries: Entry[] } {
  const depth = Math.max(1, Math.ceil(Math.log2(entries.length)));
  const size = 2 ** depth;

  const padded: Entry[] = [...entries];
  while (padded.length < size) {
    padded.push({ username: "", balance: 0n });
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

import { encodePacked, keccak256 } from "viem";

export const keccakHash: HashFn = (values) => {
  const packed = encodePacked(
    values.map(() => "uint256"),
    values,
  );
  return BigInt(keccak256(packed));
};
