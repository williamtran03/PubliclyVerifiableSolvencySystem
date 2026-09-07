import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Noir} from '@noir-lang/noir_js';
import {compileCircuit} from './compile.ts';
import {generateProof} from './prove.ts';
import {build,hashing,randomField,hexField,verifyInclusion} from './tree.ts';
import {evm} from '../testing/evm.ts';
import {createAddressFromString} from '@ethereumjs/util';

test('ZK circuit and real Solidity verifier protect the complete snapshot',async()=>{
  const e=await evm();
  const verifier=await e.deploy('contracts/generated/NoirVerifier.sol','HonkVerifier');
  const vault=await e.deploy('contracts/ZkSolvencyVault.sol','ZkSolvencyVault',[verifier.address]);
  await e.call(vault,'',[],2000n);
  const ctx={epoch:1n,chain:31337n,registry:BigInt(vault.address)};
  const records=[100n,200n,300n,400n].map((balance,i)=>({id:BigInt(i+1),salt:randomField(),balance}));
  const api=await hashing();
  const tree=await build(api,records,ctx);
  for(let index=0;index<4;index++) {
    const p={index,record:records[index],siblings:[tree.leaves[index^1],tree.middle[(index>>1)^1]]};
    assert.equal(await verifyInclusion(api,p,ctx,tree.root),true);
    assert.equal(await verifyInclusion(api,{...p,record:{...p.record,balance:p.record.balance+1n}},ctx,tree.root),false);
    assert.equal(await verifyInclusion(api,p,ctx,{...tree.root,hash:tree.root.hash+1n}),false);
  }
  await api.destroy();
  const inputs={root:tree.root.hash.toString(),total:'1000',assets:'2000',epoch:'1',chain:'31337',registry:ctx.registry.toString(),
    ids:records.map(r=>r.id.toString()),salts:records.map(r=>r.salt.toString()),balances:records.map(r=>r.balance.toString())};
  const circuit=await compileCircuit();const noir=new Noir(circuit);
  for(const bad of [{...inputs,total:'999'},{...inputs,assets:'999'},{...inputs,balances:['-1','200','300','400']},
    {...inputs,balances:[(2n**64n).toString(),'200','300','400']},{...inputs,ids:['1','1','3','4']},
    {...inputs,epoch:'2'},{...inputs,salts:['1',...inputs.salts.slice(1)]}]) await assert.rejects(()=>noir.execute(bad));
  await assert.rejects(()=>e.call(vault,'beginSnapshot',[hexField(tree.root.hash),1000n],0n,createAddressFromString('0x2000000000000000000000000000000000000002')));
  await assert.rejects(()=>e.call(vault,'beginSnapshot',[hexField(tree.root.hash),2001n]));
  await e.call(vault,'beginSnapshot',[hexField(tree.root.hash),1000n]);
  await assert.rejects(()=>e.call(vault,'withdraw',[e.owner.toString(),1n]));
  await assert.rejects(()=>e.call(vault,'cancelSnapshot'));
  const p=await generateProof(inputs);
  assert.equal((await e.call(verifier,'verify',[p.proof,p.publicInputs])).value,true);
  for(let i=0;i<6;i++) {
    const wrong=[...p.publicInputs];wrong[i]=hexField(BigInt(wrong[i])+1n);
    await assert.rejects(async()=>{const r=await e.call(verifier,'verify',[p.proof,wrong]);if(r.value!==true)throw Error('invalid');});
  }
  await assert.rejects(()=>e.call(vault,'submitProof',[1n,'0x1234']));
  const accepted=await e.call(vault,'submitProof',[1n,p.proof]);
  assert.equal((await e.call(vault,'pending')).value,0n);
  assert.equal(((await e.call(vault,'snapshots',[1n])).value as unknown[])[5],true);
  await assert.rejects(()=>e.call(vault,'submitProof',[1n,p.proof]));
  await e.call(vault,'withdraw',[e.owner.toString(),1n]);
  console.log('ZK EVM submit gas:',accepted.gas.toString());
});
