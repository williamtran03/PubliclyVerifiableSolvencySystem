import { encodeAbiParameters, encodePacked, keccak256, parseAbiParameters, type Hex } from 'viem';
import { BITS,D,N,R,VANISHING,OMEGA,mod,pow,inv,interpolate,add,scale,multiply,divide } from './polynomial.ts';
import { commit,opening,verifyOpening,verifyDegree,verifyBalanceRelation,randomScalar,type G1,type SRS } from './kzg.ts';
export type Context={epoch:bigint;chain:bigint;registry:bigint;assets:bigint};
export type Customer={id:bigint;balance:bigint};
export type Proof={commitments:G1[];degrees:G1[];values:bigint[];openings:G1[];sumProof:G1};
export const bounds=[3,3,...Array<number>(BITS).fill(5),...Array<number>(BITS).fill(6),1];
export const DOMAIN=BigInt(keccak256(new TextEncoder().encode('Case5/Snarkless/v1')));
export function commitmentHash(c:G1[]):Hex {return keccak256(encodePacked(['uint256[]'],[[...c[0],...c[1]]]));}
export function challenge(p:Pick<Proof,'commitments'|'degrees'>,total:bigint,ctx:Context) {
  return BigInt(keccak256(encodePacked(['uint256[]'],[[DOMAIN,ctx.chain,ctx.registry,ctx.epoch,ctx.assets,total,
    ...p.commitments.flat(),...p.degrees.flat()]])))%R;
}
export function prove(customers:Customer[],ctx:Context,s:SRS) {
  if(customers.length!==N||new Set(customers.map(c=>c.id)).size!==N)throw Error('four distinct IDs required');
  if(customers.some(c=>c.id<=0n||c.id>=R||c.balance<0n||c.balance>=1n<<BigInt(BITS)))throw Error('invalid customer');
  const total=customers.reduce((a,c)=>a+c.balance,0n);
  if(total>ctx.assets)throw Error('insolvent');
  const balance=interpolate(customers.map(c=>c.balance));
  const ids=interpolate(customers.map(c=>c.id));
  // Mask each bit polynomial outside the customer domain. Unmasked bit commitments
  // would expose all four bits through enumeration of only 16 possible vectors.
  const bits=Array.from({length:BITS},(_,j)=>add(interpolate(customers.map(c=>(c.balance>>BigInt(j))&1n)),
    multiply(VANISHING,[randomScalar(),randomScalar()])));
  const quotients=bits.map(b=>divide(multiply(b,add(b,[-1n])),VANISHING));
  const weighted=bits.reduce((a,b,j)=>add(a,scale(b,1n<<BigInt(j))),[0n]);
  const relation=divide(add(weighted,scale(balance,-1n)),VANISHING);
  const polys=[balance,ids,...bits,...quotients,relation];
  const commitments=polys.map(p=>commit(p,s));
  const degrees=polys.map((p,i)=>commit(p,s,D-bounds[i]));
  const z=challenge({commitments,degrees},total,ctx);
  if(z===0n||pow(z,4n)===1n)throw Error('degenerate challenge: regenerate proof');
  // Do NOT open the unmasked balance/identity polynomials at the public challenge.
  // Their linear relation to the masked bits is verified homomorphically instead.
  const opened=polys.map((p,i)=>i<2||i===34?{value:0n,proof:[0n,0n] as G1}:opening(p,z,s));
  const proof:Proof={commitments,degrees,values:opened.map(o=>o.value),openings:opened.map(o=>o.proof),sumProof:opening(balance,0n,s).proof};
  const inclusions=customers.map((customer,index)=>({index,customer,balance:opening(balance,pow(OMEGA,BigInt(index)),s).proof,
    identity:opening(ids,pow(OMEGA,BigInt(index)),s).proof}));
  return {proof,total,inclusions};
}
export function verify(p:Proof,total:bigint,ctx:Context,s:SRS):boolean {
  try {
    if(total<0n||total>=4n*(1n<<16n)||total>ctx.assets||p.commitments.length!==35||p.degrees.length!==35||p.values.length!==35||p.openings.length!==35)return false;
    const z=challenge(p,total,ctx);if(z===0n||pow(z,4n)===1n)return false;
    if(!verifyOpening(p.commitments[0],0n,mod(total*inv(4n)),p.sumProof,s))return false;
    for(let i=0;i<35;i++) {
      if(!verifyDegree(p.commitments[i],p.degrees[i],bounds[i],s))return false;
      if(i<2||i===34) {if(p.values[i]!==0n||p.openings[i].some(x=>x!==0n))return false;}
      else if(!verifyOpening(p.commitments[i],z,p.values[i],p.openings[i],s))return false;
    }
    const van=mod(pow(z,4n)-1n);
    for(let j=0;j<BITS;j++) {
      const b=p.values[2+j];if(mod(b*(b-1n))!==mod(van*p.values[2+BITS+j]))return false;
    }
    return verifyBalanceRelation(p.commitments[0],p.commitments.slice(2,18),p.commitments[34],s);
  } catch {return false;}
}
export function verifyCustomer(i:ReturnType<typeof prove>['inclusions'][number],trusted:G1[],expected:Customer,s:SRS) {
  if(!Number.isInteger(i.index)||i.index<0||i.index>=N||i.customer.id!==expected.id||i.customer.balance!==expected.balance)return false;
  const x=pow(OMEGA,BigInt(i.index));
  return verifyOpening(trusted[0],x,expected.balance,i.balance,s)&&verifyOpening(trusted[1],x,expected.id,i.identity,s);
}
export const proofAbi=parseAbiParameters('(uint256[2][35] commitments,uint256[2][35] degrees,uint256[35] values,uint256[2][35] openings,uint256[2] sumProof)');
export function encodeProof(p:Proof) {return encodeAbiParameters(proofAbi,[p as never]);}
