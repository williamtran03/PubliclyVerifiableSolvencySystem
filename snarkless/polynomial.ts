// Summa V2's roots-of-unity interpolation, over BN254's SCALAR field.
export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const N = 4;
export const BITS = 16;
export const D = 8;
export const mod = (x: bigint) => ((x % R) + R) % R;
export function pow(x: bigint, e: bigint): bigint {
  let y=1n; for(x=mod(x);e>0n;e>>=1n,x=mod(x*x)) if(e&1n)y=mod(y*x); return y;
}
export function inv(x: bigint) { if(mod(x)===0n)throw Error('division by zero');return pow(x,R-2n); }
export const OMEGA = pow(5n,(R-1n)/4n);
export function evaluate(p: bigint[], x: bigint) { return p.reduceRight((a,c)=>mod(a*x+c),0n); }
export function interpolate(values: bigint[]): bigint[] {
  if(values.length!==N || values.some(v=>v<0n||v>=R))throw Error('four canonical values required');
  return values.map((_,k)=>mod(values.reduce((a,v,i)=>a+v*pow(OMEGA,BigInt((N-(i*k)%N)%N)),0n)*inv(4n)));
}
export function add(a: bigint[],b: bigint[]) { return Array.from({length:Math.max(a.length,b.length)},(_,i)=>mod((a[i]??0n)+(b[i]??0n))); }
export function scale(a: bigint[],k: bigint) { return a.map(x=>mod(x*k)); }
export function multiply(a: bigint[],b: bigint[]) {
  const out=Array<bigint>(a.length+b.length-1).fill(0n);
  a.forEach((x,i)=>b.forEach((y,j)=>{out[i+j]=mod(out[i+j]+x*y);})); return out;
}
export function divide(p: bigint[], divisor: bigint[]) {
  const rem=p.map(mod); const q=Array<bigint>(Math.max(1,p.length-divisor.length+1)).fill(0n);
  for(let i=p.length-1;i>=divisor.length-1;i--) {
    const k=i-divisor.length+1; q[k]=mod(rem[i]*inv(divisor.at(-1)!));
    divisor.forEach((v,j)=>{rem[k+j]=mod(rem[k+j]-q[k]*v);});
  }
  if(rem.some(x=>x!==0n))throw Error('nonzero polynomial remainder');return q;
}
export const VANISHING = [-1n,0n,0n,0n,1n];
