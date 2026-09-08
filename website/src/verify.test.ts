import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoProof,parseProof,serialize,verifyInclusion,FIELD} from './verify.ts';
import {readSnapshot} from './registry.ts';
const ROOT=5345354942072680064003723022708287438241328346052966687511624372899246133615n;
const commitment={rootHash:ROOT,liabilities:49550n};
function raw(){return JSON.parse(serialize(demoProof()));}
test('matches the current main branch fixture root and verifies its example customer',()=>{
 const proof=parseProof(serialize(demoProof()));assert.equal(proof.rootHash,ROOT);assert.equal(proof.rootSum,49550n);
 assert.doesNotThrow(()=>verifyInclusion(proof,'customer-123','12550',commitment));
});
test('rejects wrong customer and expected balance',()=>{
 const p=demoProof();assert.throws(()=>verifyInclusion(p,'customer-456','12550',commitment));assert.throws(()=>verifyInclusion(p,'customer-123','12551',commitment));
});
test('rejects a changed balance, sibling hash, sibling sum and direction',()=>{
 for(const field of ['balance','hash','sum','direction']){const p=raw();if(field==='balance')p.entry.balance='12551';if(field==='hash')p.siblingHashes[0]='1';if(field==='sum')p.siblingSums[0]='5001';if(field==='direction')p.pathIndices[0]=1;
 assert.throws(()=>verifyInclusion(parseProof(JSON.stringify(p)),'customer-123',p.entry.balance,commitment));}
});
test('rejects a stale root and a separately understated on-chain total',()=>{
 const p=demoProof();assert.throws(()=>verifyInclusion(p,'customer-123','12550',{...commitment,rootHash:1n}));assert.throws(()=>verifyInclusion(p,'customer-123','12550',{...commitment,liabilities:1n}));
});
test('rejects negative, noncanonical, oversized and malformed proof data',()=>{
 for(const amount of ['-1','01','1.1',1,(1n<<64n).toString()]){const p=raw();p.entry.balance=amount;assert.throws(()=>parseProof(JSON.stringify(p)));}
 const bad=raw();bad.siblingHashes[0]=FIELD.toString();assert.throws(()=>parseProof(JSON.stringify(bad)));
 const path=raw();path.pathIndices=[0,0,2];assert.throws(()=>parseProof(JSON.stringify(path)));
 const short=raw();short.siblingSums=[];assert.throws(()=>parseProof(JSON.stringify(short)));
 assert.throws(()=>parseProof('{'));assert.throws(()=>parseProof(' '.repeat(262145)));
});
test('rejects insecure remote RPC, invalid address and invalid chain input before networking',async()=>{
 await assert.rejects(readSnapshot('http://example.com','0x123','1'));
 await assert.rejects(readSnapshot('https://example.com','0x123','1'));
 await assert.rejects(readSnapshot('https://example.com','0x1000000000000000000000000000000000000001','1.5'));
});
test('reads the registry at one pinned block without transmitting customer data',async()=>{
 const {encodeAbiParameters,parseAbi,encodeFunctionData}=await import('viem');
 const abi=parseAbi(['function currentEpoch() view returns (uint256,uint256,uint64)','function totalReserves() view returns (uint256)','function epochCount() view returns (uint256)','function verifier() view returns (address)']);
 const results=new Map([
  [encodeFunctionData({abi,functionName:'currentEpoch'}),encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint64'}],[ROOT,49550n,1700000000n])],
  [encodeFunctionData({abi,functionName:'totalReserves'}),encodeAbiParameters([{type:'uint256'}],[60000n])],
  [encodeFunctionData({abi,functionName:'epochCount'}),encodeAbiParameters([{type:'uint256'}],[1n])],
  [encodeFunctionData({abi,functionName:'verifier'}),encodeAbiParameters([{type:'address'}],['0x2000000000000000000000000000000000000002'])],
 ]);
 const original=globalThis.fetch;const calls:any[]=[];
 globalThis.fetch=async (_request,options)=>{const body=JSON.parse(String(options?.body));calls.push(body);let result;
 if(body.method==='eth_chainId')result='0x7a69';else if(body.method==='eth_blockNumber')result='0x2a';else if(body.method==='eth_getCode')result='0x6000';else if(body.method==='eth_call')result=results.get(body.params[0].data);else throw new Error('Unexpected RPC method');
 return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'Content-Type':'application/json'}});};
 try{const s=await readSnapshot('https://example.com','0x1000000000000000000000000000000000000001','31337');assert.equal(s.rootHash,ROOT);assert.equal(s.block,42n);assert.equal(s.epoch,0n);assert.equal(s.assets,60000n);
 for(const c of calls.filter(c=>['eth_call','eth_getCode'].includes(c.method)))assert.equal(c.params[1],'0x2a');
 assert.equal(JSON.stringify(calls).includes('customer-123'),false);
 }finally{globalThis.fetch=original;}
});
