import { poseidon2Hash } from '@zkpassport/poseidon2';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_BALANCE = (1n << 64n) - 1n;
export type Proof = { rootHash: bigint; rootSum: bigint; entry: { username: string; balance: bigint }; siblingHashes: bigint[]; siblingSums: bigint[]; pathIndices: number[] };
export type Commitment = { rootHash: bigint; liabilities: bigint };
export class VerificationError extends Error { constructor(message: string, public step: 'identity' | 'path' | 'snapshot' = 'path') { super(message); } }
export function decimal(value: unknown, max: bigint, label: string): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9]\d*)$/.test(value)) throw new VerificationError(`${label} must be an unsigned decimal string.`);
  const n = BigInt(value);
  if (n > max) throw new VerificationError(`${label} is outside the supported range.`);
  return n;
}
function usernameField(username: string): bigint {
  const bytes = new TextEncoder().encode(username);
  if (bytes.length > 32) throw new VerificationError('Customer ID is too long for this circuit.', 'identity');
  const result = bytes.length ? BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')) : 0n;
  if (result >= FIELD) throw new VerificationError('Customer ID is outside the circuit field.', 'identity');
  return result;
}
export function parseProof(text: string): Proof {
  if (text.length > 262144) throw new VerificationError('Proof file is too large. Maximum: 256 KB.');
  let p: any;
  try { p = JSON.parse(text); } catch { throw new VerificationError('This is not a valid JSON file.'); }
  if (!p || typeof p !== 'object' || !p.entry || typeof p.entry.username !== 'string' || p.entry.username.length > 128) throw new VerificationError('Expected a customer inclusion proof from the main branch.');
  for (const name of ['siblingHashes','siblingSums','pathIndices']) if (!Array.isArray(p[name]) || p[name].length !== 3) throw new VerificationError('This portal supports the main branch’s eight-leaf Poseidon2 tree (three proof levels).');
  if (p.pathIndices.some((n: unknown) => n !== 0 && n !== 1)) throw new VerificationError('Invalid proof path direction.');
  return {
    rootHash: decimal(p.rootHash, FIELD - 1n, 'Root'), rootSum: decimal(p.rootSum, MAX_BALANCE * 8n, 'Liability total'),
    entry: { username: p.entry.username, balance: decimal(p.entry.balance, MAX_BALANCE, 'Balance') },
    siblingHashes: p.siblingHashes.map((n: unknown) => decimal(n, FIELD - 1n, 'Sibling hash')),
    siblingSums: p.siblingSums.map((n: unknown, i: number) => decimal(n, MAX_BALANCE * (1n << BigInt(i)), 'Sibling sum')),
    pathIndices: p.pathIndices,
  };
}
export function verifyInclusion(p: Proof, username: string, expectedBalance: string, snapshot: Commitment): void {
  if (!username || username !== p.entry.username) throw new VerificationError('The customer ID does not match the proof.', 'identity');
  const expected = decimal(expectedBalance, MAX_BALANCE, 'Expected balance');
  if (p.entry.balance !== expected) throw new VerificationError('The proof balance does not match your expected balance.', 'identity');
  let hash = poseidon2Hash([usernameField(p.entry.username), p.entry.balance]);
  let sum = p.entry.balance;
  for (let i = 0; i < 3; i++) {
    const sibling = p.siblingHashes[i], siblingSum = p.siblingSums[i];
    hash = poseidon2Hash(p.pathIndices[i] === 1 ? [sibling, siblingSum, hash, sum] : [hash, sum, sibling, siblingSum]);
    sum += siblingSum;
  }
  if (hash !== p.rootHash || sum !== p.rootSum) throw new VerificationError('The proof does not reconstruct its claimed root and total.', 'path');
  if (hash !== snapshot.rootHash || sum !== snapshot.liabilities) throw new VerificationError('The proof belongs to a different commitment or the published total does not match.', 'snapshot');
}
export function demoProof(): Proof {
  const records = [{username:'customer-123',balance:12550n},{username:'customer-456',balance:5000n},{username:'customer-789',balance:32000n},...Array.from({length:5},()=>({username:'',balance:0n}))];
  let nodes = records.map(e=>({hash:poseidon2Hash([usernameField(e.username),e.balance]),sum:e.balance}));
  const siblingHashes:bigint[]=[], siblingSums:bigint[]=[], pathIndices:number[]=[];
  while(nodes.length>1){siblingHashes.push(nodes[1].hash);siblingSums.push(nodes[1].sum);pathIndices.push(0);const next=[];for(let i=0;i<nodes.length;i+=2)next.push({hash:poseidon2Hash([nodes[i].hash,nodes[i].sum,nodes[i+1].hash,nodes[i+1].sum]),sum:nodes[i].sum+nodes[i+1].sum});nodes=next;}
  return {rootHash:nodes[0].hash,rootSum:nodes[0].sum,entry:records[0],siblingHashes,siblingSums,pathIndices};
}
export const serialize = (p: Proof) => JSON.stringify(p, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
