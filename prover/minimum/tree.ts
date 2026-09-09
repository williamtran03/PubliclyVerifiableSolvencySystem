import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
export const MAX = (1n << 256n) - 1n;
export const USD_SCALE = 100000000n;
export const domain = (s: string) => keccak256(stringToHex(`solvency.minimum.v1.${s}`));
export const hash = (types: string[], values: unknown[]): Hex => keccak256(encodeAbiParameters(types.map(type => ({ type })), values));
export function uint(v: bigint): bigint { if (typeof v !== 'bigint' || v < 0n || v > MAX) throw Error('uint256 overflow or negative'); return v; }
export function bytes32(v: string): asserts v is Hex { if (!/^0x[0-9a-f]{64}$/i.test(v)) throw Error('bytes32 required'); }
export function capacityCheck(n: number) { if (!Number.isInteger(n) || n < 2 || n > 256 || (n & (n - 1))) throw Error('capacity must be power of two, 2..256'); }
export type Node = { hash: Hex; sum: bigint };
export type Pair = { identity: Hex; amount: bigint };
export type Ledger = { version: 1; snapshotId: Hex; capacity: number; padding: 'trailing-domain-v1'; pairs: Pair[]; rootHash: Hex; rootSum: bigint };
export type Part = { partIndex: number; salt: Hex; nonce: Hex; amount: bigint; pairPosition: number; siblings: Node[]; path: number[] };
export type Bundle = { snapshotId: Hex; customerId: string; dateOfBirth: string; expectedBalance: bigint; capacity: number; rootHash: Hex; rootSum: bigint; parts: Part[] };
export type Anchor = Pick<Bundle, 'snapshotId' | 'rootHash' | 'rootSum' | 'capacity'>;
export function identity(snapshot: Hex, customer: string, dob: string, index: number, salt: Hex, nonce: Hex): Hex {
  [snapshot, salt, nonce].forEach(bytes32); if (!Number.isSafeInteger(index) || index < 0) throw Error('index');
  return hash(['bytes32','bytes32','string','string','uint256','bytes32','bytes32'], [domain('identity'), snapshot, customer, dob, BigInt(index), salt, nonce]);
}
export function balance(snapshot: Hex, position: number, amount: bigint): Node {
  bytes32(snapshot); uint(amount); if (!Number.isSafeInteger(position) || position < 0) throw Error('position');
  return { hash: hash(['bytes32','bytes32','uint256','uint256'], [domain('balance'), snapshot, BigInt(position), amount]), sum: amount };
}
export function combine(left: Node, right: Node, kind = 'node'): Node {
  bytes32(left.hash); bytes32(right.hash); uint(left.sum); uint(right.sum);
  return { hash: hash(['bytes32','bytes32','uint256','bytes32','uint256'], [domain(kind), left.hash, left.sum, right.hash, right.sum]), sum: uint(left.sum + right.sum) };
}
export const pairNode = (snapshot: Hex, position: number, p: Pair) => combine({ hash: p.identity, sum: 0n }, balance(snapshot, position, p.amount), 'pair');
export const paddingIdentity = (snapshot: Hex, position: number) => hash(['bytes32','bytes32','uint256'], [domain('padding'), snapshot, BigInt(position)]);
export function tree(snapshot: Hex, capacity: number, pairs: Pair[]) {
  bytes32(snapshot); capacityCheck(capacity); if (pairs.length > capacity) throw Error('capacity exceeded');
  const seen = new Set<string>();
  for (const p of pairs) { bytes32(p.identity); uint(p.amount); if (p.amount === 0n || seen.has(p.identity.toLowerCase())) throw Error('zero real part or repeated identity'); seen.add(p.identity.toLowerCase()); }
  const levels: Node[][] = [Array.from({length: capacity}, (_, i) => pairNode(snapshot, i, pairs[i] ?? { identity: paddingIdentity(snapshot, i), amount: 0n }))];
  while (levels.at(-1)!.length > 1) { const prev = levels.at(-1)!; levels.push(Array.from({length: prev.length / 2}, (_, i) => combine(prev[2*i], prev[2*i+1]))); }
  return { levels, root: levels.at(-1)![0] };
}
export function audit(ledger: Ledger): boolean { try { if (ledger.version !== 1 || ledger.padding !== 'trailing-domain-v1') return false; const {root} = tree(ledger.snapshotId, ledger.capacity, ledger.pairs); return root.hash === ledger.rootHash && root.sum === ledger.rootSum; } catch { return false; } }
// Identity and expected full balance must come from independent customer records.
export function verify(bundle: Bundle, expected: {customerId: string; dateOfBirth: string; balance: bigint}, anchor: Anchor): boolean {
  try {
    uint(expected.balance); uint(bundle.expectedBalance); capacityCheck(anchor.capacity);
    if (bundle.customerId !== expected.customerId || bundle.dateOfBirth !== expected.dateOfBirth || bundle.expectedBalance !== expected.balance || bundle.snapshotId !== anchor.snapshotId || bundle.rootHash !== anchor.rootHash || bundle.rootSum !== anchor.rootSum || bundle.capacity !== anchor.capacity || bundle.parts.length > anchor.capacity) return false;
    if (expected.balance === 0n || bundle.parts.length === 0) return false;
    const positions = new Set<number>(), indices = new Set<number>(), secrets = new Set<string>(); let total = 0n;
    for (const p of bundle.parts) {
      if (!Number.isInteger(p.partIndex) || p.partIndex < 0 || p.partIndex >= bundle.parts.length || indices.has(p.partIndex) || !Number.isInteger(p.pairPosition) || p.pairPosition < 0 || p.pairPosition >= anchor.capacity || positions.has(p.pairPosition)) return false;
      for (const secret of [p.salt,p.nonce]) { bytes32(secret); if (secrets.has(secret.toLowerCase())) return false; secrets.add(secret.toLowerCase()); }
      indices.add(p.partIndex); positions.add(p.pairPosition); uint(p.amount); if (!p.amount) return false;
      let node = pairNode(bundle.snapshotId, p.pairPosition, {identity: identity(bundle.snapshotId,bundle.customerId,bundle.dateOfBirth,p.partIndex,p.salt,p.nonce), amount:p.amount});
      if (p.siblings.length !== Math.log2(anchor.capacity) || p.path.length !== p.siblings.length) return false;
      for (let j=0; j<p.siblings.length; j++) { const direction = (p.pairPosition >> j) & 1; if (p.path[j] !== direction) return false; node = direction ? combine(p.siblings[j],node) : combine(node,p.siblings[j]); }
      if (node.hash !== anchor.rootHash || node.sum !== anchor.rootSum) return false;
      total = uint(total + p.amount);
    }
    return total === expected.balance;
  } catch { return false; }
}
export const stringify = (value: unknown) => JSON.stringify(value, (_k,v) => typeof v === 'bigint' ? v.toString() : v, 2);
const integers = new Set(['sum','amount','rootSum','expectedBalance','rawAmount','rate','roundId','updatedAt','usd','snapshotTime']);
export const parse = <T>(s: string): T => JSON.parse(s, (k,v) => { if (!integers.has(k)) return v; if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v) || v.length > 78) throw Error('noncanonical integer'); return uint(BigInt(v)); });
