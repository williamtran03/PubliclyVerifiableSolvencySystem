import { randomBytes } from 'node:crypto';
import type { Hex } from 'viem';
import { uint, capacityCheck, identity, tree, type Part, type Bundle, type Ledger, type Pair } from './tree.ts';
export type Customer = { customerId: string; dateOfBirth: string; balance: bigint };
export type Random = { secret(): Hex; below(limit: bigint): bigint };
export const secureRandom: Random = {
  secret: () => `0x${randomBytes(32).toString('hex')}`,
  below: limit => { if (limit <= 0n) throw Error('random bound'); const width = Math.ceil(limit.toString(2).length/8); const ceiling = 1n << BigInt(width*8); const cutoff = ceiling - ceiling % limit; for (;;) { const value = BigInt(`0x${randomBytes(width).toString('hex')}`); if (value < cutoff) return value % limit; } },
};
export function build(customers: Customer[], snapshotId: Hex, capacity=64, minParts=2, maxParts=4, random=secureRandom) {
  capacityCheck(capacity); if (!Number.isInteger(minParts) || !Number.isInteger(maxParts) || minParts < 1 || maxParts < minParts || maxParts > capacity) throw Error('parts configuration');
  const entries: {pair:Pair; part:Part}[] = [], bundles: Bundle[] = []; const ids = new Set<string>(), secrets = new Set<string>();
  const fresh = () => { const s = random.secret(); if (secrets.has(s.toLowerCase())) throw Error('reused salt or nonce'); secrets.add(s.toLowerCase()); return s; };
  const draw = (bound: bigint) => { const n = random.below(bound); if (n < 0n || n >= bound) throw Error('random bound'); return n; };
  for (const c of customers) {
    uint(c.balance); if (!c.customerId || !c.dateOfBirth || ids.has(c.customerId) || c.balance < BigInt(minParts)) throw Error('duplicate customer or insufficient balance for positive parts'); ids.add(c.customerId);
    const max = Number(c.balance < BigInt(maxParts) ? c.balance : BigInt(maxParts));
    const count = minParts + Number(draw(BigInt(max-minParts+1))); let remaining=c.balance;
    const bundle: Bundle = {snapshotId, customerId:c.customerId,dateOfBirth:c.dateOfBirth,expectedBalance:c.balance,capacity,rootHash:'0x',rootSum:0n,parts:[]};
    for (let i=0;i<count;i++) {
      const amount = i === count-1 ? remaining : 1n + draw(remaining-BigInt(count-i-1)); remaining-=amount;
      const part: Part = {partIndex:i,salt:fresh(),nonce:fresh(),amount,pairPosition:0,siblings:[],path:[]};
      entries.push({pair:{identity:identity(snapshotId,c.customerId,c.dateOfBirth,i,part.salt,part.nonce),amount},part}); bundle.parts.push(part);
    }
    bundles.push(bundle);
  }
  if (entries.length > capacity) throw Error('capacity exceeded');
  for (let i=entries.length-1;i>0;i--) { const j=Number(draw(BigInt(i+1))); [entries[i],entries[j]]=[entries[j],entries[i]]; }
  const {root,levels}=tree(snapshotId,capacity,entries.map(e=>e.pair));
  entries.forEach((e,i) => { e.part.pairPosition=i; let pos=i; for (let level=0;level<levels.length-1;level++) { e.part.path.push(pos&1); e.part.siblings.push(levels[level][pos^1]); pos>>=1; } });
  bundles.forEach(b=>{ b.rootHash=root.hash;b.rootSum=root.sum; });
  const ledger:Ledger={version:1,snapshotId,capacity,padding:'trailing-domain-v1',pairs:entries.map(e=>e.pair),rootHash:root.hash,rootSum:root.sum};
  return {ledger,bundles};
}
