import { Barretenberg, BackendType } from '@aztec/bb.js';
import { randomBytes } from 'node:crypto';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export type Context = { epoch: bigint; chain: bigint; registry: bigint };
export type Record = { id: bigint; salt: bigint; balance: bigint };
export type Node = { hash: bigint; sum: bigint };
export const fieldBytes = (n: bigint) => Uint8Array.from(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
export const hexField = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as const;
export const randomField = () => BigInt(`0x${randomBytes(31).toString('hex')}`) + 1n;
export async function hashing() {
  return Barretenberg.new({ backend: BackendType.Wasm, threads: 1, skipSrsInit: true });
}
export async function hash(api: Barretenberg, values: bigint[]): Promise<bigint> {
  if (values.some(v => v < 0n || v >= FIELD)) throw Error('non-canonical field');
  const result = await api.poseidon2Hash({ inputs: values.map(fieldBytes) });
  return BigInt(`0x${Buffer.from(result.hash).toString('hex')}`);
}
export async function leaf(api: Barretenberg, r: Record, c: Context): Promise<Node> {
  if (r.balance < 0n || r.balance >= 2n**64n || r.id <= 0n || r.salt <= 0n) throw Error('invalid record');
  return { hash: await hash(api, [1n,c.epoch,c.chain,c.registry,r.id,r.salt,r.balance]), sum: r.balance };
}
async function combine(api: Barretenberg, a: Node, b: Node): Promise<Node> {
  if (a.sum < 0n || b.sum < 0n || a.sum+b.sum >= 2n**128n) throw Error('invalid sum');
  return { hash: await hash(api, [2n,a.hash,a.sum,b.hash,b.sum]), sum: a.sum+b.sum };
}
export async function build(api: Barretenberg, records: Record[], context: Context) {
  if (records.length !== 4 || new Set(records.map(r=>r.id)).size !== 4) throw Error('four unique records required');
  const leaves = await Promise.all(records.map(r=>leaf(api,r,context)));
  const middle = [await combine(api,leaves[0],leaves[1]),await combine(api,leaves[2],leaves[3])];
  return { root: await combine(api,middle[0],middle[1]), leaves, middle };
}
export type Inclusion = { index: number; record: Record; siblings: Node[] };
export async function verifyInclusion(api: Barretenberg, proof: Inclusion, context: Context, trustedRoot: Node) {
  try {
    if (!Number.isInteger(proof.index) || proof.index<0 || proof.index>=4 || proof.siblings.length!==2) return false;
    let current = await leaf(api,proof.record,context);
    for(let depth=0;depth<2;depth++) current = (proof.index>>depth)&1
      ? await combine(api,proof.siblings[depth],current) : await combine(api,current,proof.siblings[depth]);
    return current.hash===trustedRoot.hash && current.sum===trustedRoot.sum;
  } catch { return false; }
}
