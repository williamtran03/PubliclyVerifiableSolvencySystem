import { BALANCE_BITS, BN254_FR, MAX_BALANCE } from "./field.ts";
import { usernameToField, type HashFn } from "./hash.ts";

export type Entry = {
  username: string;
  balance: bigint;
};

/**
 * A tree slot. `username` is `null` for the zero-balance filler leaves that pad
 * the customer list up to a power of two.
 */
export type Leaf = {
  id: bigint;
  balance: bigint;
  username: string | null;
};

export type Node = {
  hash: bigint;
  sum: bigint;
};

export type Tree = {
  depth: number;
  levels: Node[][];
  leaves: Leaf[];
  root: Node;
};

export type MerkleSumProof = {
  rootHash: bigint;
  rootSum: bigint;
  username: string;
  id: bigint;
  balance: bigint;
  siblingHashes: bigint[];
  siblingSums: bigint[];
  pathIndices: number[]; // 0: this node is the left child; 1: the right child
};

export function serializeProof(proof: MerkleSumProof): string {
  return JSON.stringify(
    proof,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

export function deserializeProof(json: string): MerkleSumProof {
  const p = JSON.parse(json);
  return {
    rootHash: BigInt(p.rootHash),
    rootSum: BigInt(p.rootSum),
    username: p.username,
    id: BigInt(p.id),
    balance: BigInt(p.balance),
    siblingHashes: p.siblingHashes.map(BigInt),
    siblingSums: p.siblingSums.map(BigInt),
    pathIndices: p.pathIndices,
  };
}

/**
 * Turns the raw customer list into the exact leaf vector the tree is built
 * from: validated, sorted by id, and padded to a power of two.
 *
 * Sorting is load-bearing. The circuit proves the leaves are *strictly
 * increasing* in id, and strictly-increasing implies pairwise distinct — which
 * is what stops the prover from listing one customer twice (inflating a
 * neighbour's apparent share) or, more importantly, from giving two customers
 * the same leaf so that only one of them is really in the tree.
 *
 * Padding continues the increasing sequence (`lastId + 1 + k`) instead of using
 * a fixed sentinel, so the strict-ordering property still holds across the
 * filler leaves and the circuit needs no special case for them.
 */
export function toLeaves(entries: Entry[]): Leaf[] {
  const seen = new Set<string>();
  const leaves: Leaf[] = entries.map((entry) => {
    if (seen.has(entry.username)) {
      throw new Error(`duplicate username: ${entry.username}`);
    }
    seen.add(entry.username);

    if (entry.balance < 0n) {
      throw new Error(`negative balance for ${entry.username}`);
    }
    if (entry.balance > MAX_BALANCE) {
      throw new Error(
        `balance for ${entry.username} exceeds ${BALANCE_BITS} bits, which the circuit cannot range-check`,
      );
    }
    return { id: usernameToField(entry.username), balance: entry.balance, username: entry.username };
  });

  leaves.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (let i = 1; i < leaves.length; i++) {
    if (leaves[i].id === leaves[i - 1].id) {
      throw new Error(
        `username hash collision between ${leaves[i - 1].username} and ${leaves[i].username}`,
      );
    }
  }

  const depth = Math.max(1, Math.ceil(Math.log2(Math.max(leaves.length, 1))));
  const size = 2 ** depth;
  let nextId = leaves.length > 0 ? leaves[leaves.length - 1].id + 1n : 1n;
  while (leaves.length < size) {
    if (nextId >= BN254_FR) throw new Error("ran out of field elements while padding");
    leaves.push({ id: nextId, balance: 0n, username: null });
    nextId += 1n;
  }

  return leaves;
}

export function computeLeaf(leaf: Pick<Leaf, "id" | "balance">, hash: HashFn): Node {
  return { hash: hash([leaf.id, leaf.balance]), sum: leaf.balance };
}

export function combineNodes(left: Node, right: Node, hash: HashFn): Node {
  const sum = left.sum + right.sum;
  if (sum < 0n) throw new Error("negative sum: a balance was negative somewhere");
  return { hash: hash([left.hash, left.sum, right.hash, right.sum]), sum };
}

export function buildTree(entries: Entry[], hash: HashFn): Tree {
  const leaves = toLeaves(entries);
  const depth = Math.log2(leaves.length);

  const levels: Node[][] = [leaves.map((leaf) => computeLeaf(leaf, hash))];
  for (let level = 1; level <= depth; level++) {
    const prev = levels[level - 1];
    const current: Node[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      current.push(combineNodes(prev[i], prev[i + 1], hash));
    }
    levels.push(current);
  }

  return { depth, levels, leaves, root: levels[depth][0] };
}

export function findLeafIndex(tree: Tree, username: string): number {
  return tree.leaves.findIndex((leaf) => leaf.username === username);
}

export function createProof(index: number, tree: Tree): MerkleSumProof {
  const leaf = tree.leaves[index];
  if (!leaf) throw new Error(`no leaf at index ${index}`);
  if (leaf.username === null) throw new Error(`leaf ${index} is padding, not a customer`);

  const siblingHashes: bigint[] = [];
  const siblingSums: bigint[] = [];
  const pathIndices: number[] = [];

  let i = index;
  for (let level = 0; level < tree.depth; level++) {
    const isRightChild = i % 2 === 1;
    const sibling = tree.levels[level][isRightChild ? i - 1 : i + 1];

    pathIndices.push(isRightChild ? 1 : 0);
    siblingHashes.push(sibling.hash);
    siblingSums.push(sibling.sum);

    i = Math.floor(i / 2);
  }

  return {
    rootHash: tree.root.hash,
    rootSum: tree.root.sum,
    username: leaf.username,
    id: leaf.id,
    balance: leaf.balance,
    siblingHashes,
    siblingSums,
    pathIndices,
  };
}

/**
 * Recomputes the path from the customer's own leaf up to a root and compares.
 *
 * Note what this does *not* check: that the root is the one currently published
 * on-chain (see `cli/verify-inclusion.ts`), or that the rest of the tree is
 * well-formed (see the circuit). It only says "this leaf is under this root".
 */
export function verifyProof(proof: MerkleSumProof, hash: HashFn): boolean {
  try {
    if (usernameToField(proof.username) !== proof.id) return false;
    if (typeof proof.balance !== "bigint" || proof.balance < 0n || proof.balance > MAX_BALANCE) return false;
    if (!Array.isArray(proof.siblingHashes) || !Array.isArray(proof.siblingSums) || !Array.isArray(proof.pathIndices) ||
        proof.siblingHashes.length === 0 || proof.siblingHashes.length !== proof.siblingSums.length ||
        proof.siblingHashes.length !== proof.pathIndices.length || proof.pathIndices.some(i => i !== 0 && i !== 1)) return false;
    const inField = (value: bigint) => typeof value === "bigint" && value >= 0n && value < BN254_FR;
    if (![proof.rootHash, proof.rootSum, ...proof.siblingHashes, ...proof.siblingSums].every(inField)) return false;
    let node = computeLeaf({ id: proof.id, balance: proof.balance }, hash);
    for (let level = 0; level < proof.siblingHashes.length; level++) {
      const sibling: Node = { hash: proof.siblingHashes[level], sum: proof.siblingSums[level] };
      node = proof.pathIndices[level] === 1 ? combineNodes(sibling, node, hash) : combineNodes(node, sibling, hash);
      if (!inField(node.sum)) return false;
    }
    return node.hash === proof.rootHash && node.sum === proof.rootSum;
  } catch { return false; }
}
