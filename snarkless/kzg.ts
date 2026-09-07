import { bn254 } from '@noble/curves/bn254.js';
import { randomBytes } from 'node:crypto';
import { D, R, mod, evaluate, divide } from './polynomial.ts';
export type G1 = [bigint,bigint];
export type G2 = [bigint,bigint,bigint,bigint]; // EIP-197: imaginary, real
export type SRS = { g1:G1[]; g2:G2[] };
const P=bn254.G1.Point, Q=bn254.G2.Point;
export const randomScalar=()=>BigInt(`0x${randomBytes(31).toString('hex')}`)+1n;
export const g1=(p:InstanceType<typeof P>):G1=>{const a=p.toAffine();return [a.x,a.y];};
export const g2=(p:InstanceType<typeof Q>):G2=>{const a=p.toAffine();return [a.x.c1,a.x.c0,a.y.c1,a.y.c0];};
export function point(p:G1) {const a=p[0]===0n&&p[1]===0n?P.ZERO:P.fromAffine({x:p[0],y:p[1]});a.assertValidity();return a;}
function point2(p:G2) {const a=Q.fromAffine({x:{c1:p[0],c0:p[1]},y:{c1:p[2],c0:p[3]}});a.assertValidity();return a;}
function mul(p:InstanceType<typeof P>,s:bigint) {s=mod(s);return s===0n?P.ZERO:p.multiply(s);}
// LOCAL DEMONSTRATION ONLY: a single-party setup is not a production ceremony.
// Never accept a prover-selected SRS in the verifier. Deploy with reviewed, pinned parameters.
export function demoSetup():SRS {
  const tau=randomScalar();let power=1n;const s:SRS={g1:[],g2:[]};
  for(let i=0;i<=D;i++,power=mod(power*tau)){s.g1.push(g1(P.BASE.multiply(power)));s.g2.push(g2(Q.BASE.multiply(power)));}
  return s; // tau is deliberately never serialized
}
export function commit(p:bigint[],s:SRS,shift=0):G1 {
  if(p.length+shift>D+1)throw Error('degree exceeds SRS');
  return g1(p.reduce((a,c,i)=>a.add(mul(point(s.g1[i+shift]),c)),P.ZERO));
}
export function opening(p:bigint[],x:bigint,s:SRS) {
  const y=evaluate(p,x);const numerator=[...p];numerator[0]=mod(numerator[0]-y);
  return {value:y,proof:commit(divide(numerator,[mod(-x),1n]),s)};
}
function pairingEqual(a:InstanceType<typeof P>,b:InstanceType<typeof Q>,c:InstanceType<typeof P>,d:InstanceType<typeof Q>) {
  const pairs=[{g1:a,g2:b},{g1:c.negate(),g2:d}].filter(p=>!p.g1.is0());
  return pairs.length===0 || bn254.fields.Fp12.eql(bn254.pairingBatch(pairs),bn254.fields.Fp12.ONE);
}
export function verifyOpening(c:G1,x:bigint,y:bigint,proof:G1,s:SRS) {
  try {
    if(x<0n||x>=R||y<0n||y>=R)return false;
    const pi=point(proof);
    return pairingEqual(point(c).subtract(mul(P.BASE,y)).add(mul(pi,x)),Q.BASE,pi,point2(s.g2[1]));
  } catch {return false;}
}
export function verifyDegree(c:G1,shifted:G1,bound:number,s:SRS) {
  try {return pairingEqual(point(c),point2(s.g2[D-bound]),point(shifted),Q.BASE);}catch{return false;}
}
export function verifyBalanceRelation(balance:G1,bits:G1[],relation:G1,s:SRS) {
  try {
    const weighted=bits.reduce((a,b,j)=>a.add(mul(point(b),1n<<BigInt(j))),P.ZERO);
    return pairingEqual(weighted.subtract(point(balance)).add(point(relation)),Q.BASE,point(relation),point2(s.g2[4]));
  }catch{return false;}
}
