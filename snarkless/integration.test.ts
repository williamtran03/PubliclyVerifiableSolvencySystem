import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prove,verify,verifyCustomer,commitmentHash,encodeProof,challenge,bounds,type Proof} from './protocol.ts';
import {demoSetup,verifyOpening,commit,opening,verifyDegree} from './kzg.ts';
import {R,D,interpolate,evaluate,OMEGA,pow,inv,mod} from './polynomial.ts';
import {evm} from '../testing/evm.ts';

test('polynomial interpolation and KZG reject false sums and excessive degree',()=>{
  const s=demoSetup();const values=[12550n,5000n,32000n,0n];const p=interpolate(values);
  values.forEach((v,i)=>assert.equal(evaluate(p,pow(OMEGA,BigInt(i))),v));
  assert.equal(mod(4n*p[0]),49550n);
  const c=commit(p,s);const o=opening(p,0n,s);
  assert.equal(verifyOpening(c,0n,o.value,o.proof,s),true);
  assert.equal(verifyOpening(c,0n,mod(49549n*inv(4n)),o.proof,s),false);
  const tooHigh=[1n,2n,3n,4n,5n];
  assert.equal(verifyDegree(commit(tooHigh,s),commit(tooHigh,s,4),3,s),false);
});

test('SNARKless real pairings, range identities, inclusion and EVM snapshot',async()=>{
  const s=demoSetup();const e=await evm();
  const verifier=await e.deploy('contracts/SnarklessVerifier.sol','SnarklessVerifier',[s.g2]);
  const vault=await e.deploy('contracts/SnarklessSolvencyVault.sol','SnarklessSolvencyVault',[verifier.address]);
  await e.call(vault,'',[],100000n);
  const ctx={epoch:1n,chain:31337n,registry:BigInt(vault.address),assets:100000n};
  const customers=[12550n,5000n,32000n,0n].map((balance,i)=>({id:BigInt(i+1),balance}));
  const {proof,total,inclusions}=prove(customers,ctx,s);
  assert.equal(verify(proof,total,ctx,s),true);
  for(const i of inclusions) {
    assert.equal(verifyCustomer(i,proof.commitments,i.customer,s),true);
    assert.equal(verifyCustomer(i,proof.commitments,{...i.customer,id:i.customer.id+1n},s),false);
    assert.equal(verifyCustomer(i,proof.commitments,{...i.customer,balance:i.customer.balance+1n},s),false);
  }
  assert.throws(()=>prove([{id:1n,balance:R-1n},...customers.slice(1)],ctx,s));
  assert.throws(()=>prove([{id:1n,balance:65536n},...customers.slice(1)],ctx,s));
  assert.throws(()=>prove(customers,{...ctx,assets:1n},s));
  assert.equal(verify(proof,total-1n,ctx,s),false);
  assert.equal(verify(proof,total,{...ctx,epoch:2n},s),false);
  const digest=commitmentHash(proof.commitments);
  await e.call(vault,'beginSnapshot',[digest,total]);
  await assert.rejects(()=>e.call(vault,'withdraw',[e.owner.toString(),1n]));
  const args=(p:Proof,t=total)=>[encodeProof(p),digest,t,ctx.assets,ctx.epoch,ctx.chain,ctx.registry];
  assert.equal((await e.call(verifier,'verify',args(proof))).value,true);
  assert.equal((await e.call(verifier,'verify',args(proof,total-1n))).value,false);
  // Adversary bypasses every host-side input check. All KZG openings below are
  // genuine, but the dataset contains -1 modulo R and has no valid range proof.
  const polys=[interpolate([R-1n,101n,0n,0n]),interpolate([1n,2n,3n,4n]),...Array.from({length:33},()=>[0n])];
  const commitments=polys.map(p=>commit(p,s));
  const degrees=polys.map((p,i)=>commit(p,s,D-bounds[i]));
  const z=challenge({commitments,degrees},100n,ctx);
  const opened=polys.map((p,i)=>i<2||i===34?{value:0n,proof:[0n,0n] as [bigint,bigint]}:opening(p,z,s));
  const forged:Proof={commitments,degrees,values:opened.map(p=>p.value),openings:opened.map(p=>p.proof),sumProof:opening(polys[0],0n,s).proof};
  assert.equal(verify(forged,100n,ctx,s),false);
  assert.equal((await e.call(verifier,'verify',[encodeProof(forged),commitmentHash(commitments),100n,ctx.assets,ctx.epoch,ctx.chain,ctx.registry])).value,false);
  for(const field of ['values','degrees','openings'] as const) {
    const bad=structuredClone(proof);
    if(field==='values')bad.values[2]=mod(bad.values[2]+1n);
    else bad[field][2]=[1n,2n];
    await assert.rejects(async()=>{const r=await e.call(verifier,'verify',args(bad));if(r.value!==true)throw Error('invalid');});
  }
  const accepted=await e.call(vault,'submitProof',[1n,encodeProof(proof)]);
  assert.equal(((await e.call(vault,'snapshots',[1n])).value as unknown[])[5],true);
  await assert.rejects(()=>e.call(vault,'submitProof',[1n,encodeProof(proof)]));
  await e.call(vault,'withdraw',[e.owner.toString(),1n]);
  console.log('SNARKless EVM submit gas:',accepted.gas.toString());
});
