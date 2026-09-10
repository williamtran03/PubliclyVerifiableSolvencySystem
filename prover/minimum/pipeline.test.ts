import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot} from './pipeline.ts';
import {MockOracle,type Rate} from './oracle.ts';
import {verify} from './tree.ts';
const rate:Rate={token:'0x0000000000000000000000000000000000000001',feed:'0x0000000000000000000000000000000000000002',tokenDecimals:6,oracleDecimals:8,rate:100000000n,roundId:1n,updatedAt:1000n};
const id=`0x${'01'.repeat(32)}` as const;
test('pipeline converts before splitting and preserves private conversion provenance',async()=>{const c={customerId:'alice',dateOfBirth:'2000-01-01',holdings:[{token:rate.token,rawAmount:1000000n}]};const result=await buildSnapshot([c],new MockOracle([rate]),id,1000n,60n,8,2,2);assert.equal(result.ledger.rootSum,100000000n);assert.equal(result.conversions[0].conversions[0].rawAmount,1000000n);assert.equal(result.manifest.length,1);assert.ok(verify(result.bundles[0],{customerId:c.customerId,dateOfBirth:c.dateOfBirth,balance:100000000n},result.ledger));assert.ok(!JSON.stringify(result.manifest,(_k,v)=>typeof v==='bigint'?String(v):v).includes('alice'));});
test('pipeline rejects inconsistent oracle rounds and missing holdings',async()=>{let call=0;const changing={getRate:async()=>({...rate,roundId:BigInt(++call)})};await assert.rejects(()=>buildSnapshot([{customerId:'a',dateOfBirth:'2000',holdings:[{token:rate.token,rawAmount:1000000n},{token:rate.token,rawAmount:1000000n}]}],changing,id,1000n,60n));await assert.rejects(()=>buildSnapshot([{customerId:'a',dateOfBirth:'2000',holdings:[]}],new MockOracle([rate]),id,1000n,60n));});
