import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from '../../prover/minimum/build.ts';
import {stringify} from '../../prover/minimum/tree.ts';
import {retrieveProof,localResult,loadState,usd,coverage,parseUsdInput,registryClient,publicSummary,exchangeRateRows, type PublicSnapshot} from './minimumClient.ts';
const customer={customerId:'private-alice',dateOfBirth:'2000-01-01',balance:10000000000n};
const fixture=()=>build([customer],`0x${'01'.repeat(32)}`,8);
test('successful authenticated retrieval performs one GET without private proof upload',async()=>{const {bundles:[bundle],ledger}=fixture();const requests:{url:string;init?:RequestInit}[]=[];const fetcher:typeof fetch=async(url,init)=>{requests.push({url:String(url),init});return new Response(stringify(bundle));};const retrieved=await retrieveProof('ab'.repeat(32),fetcher);assert.match(localResult(retrieved,customer.customerId,customer.dateOfBirth,customer.balance,ledger),/^VALID/);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/proof');assert.equal(requests[0].init?.method,'GET');assert.equal(requests[0].init?.body,undefined);assert.ok(!JSON.stringify(requests).includes(customer.customerId));assert.ok(!JSON.stringify(requests).includes(customer.dateOfBirth));assert.ok(!JSON.stringify(requests).includes(bundle.parts[0].salt));});
test('authentication is not inclusion and wrong credentials fail',async()=>{await assert.rejects(()=>retrieveProof('invalid',async()=>{throw Error('must not send')}));await assert.rejects(()=>retrieveProof('ab'.repeat(32),async()=>new Response('',{status:401})),/Authentication/);const {bundles:[b],ledger}=fixture();b.parts[0].amount++;const fetched=await retrieveProof('ab'.repeat(32),async()=>new Response(stringify(b)));assert.throws(()=>localResult(fetched,customer.customerId,customer.dateOfBirth,customer.balance,ledger));});
for(const kind of ['wrong balance','wrong customer','wrong date','tampered bundle','outdated epoch'])test(`customer UI rejects ${kind}`,()=>{const {bundles:[b],ledger}=fixture();if(kind==='outdated epoch'){b.snapshotId=`0x${'02'.repeat(32)}`;assert.match(localResult(b,customer.customerId,customer.dateOfBirth,customer.balance,ledger),/^OUTDATED EPOCH/);return;}if(kind==='tampered bundle')b.parts[0].siblings[0].sum++;assert.throws(()=>localResult(b,kind==='wrong customer'?'other':customer.customerId,kind==='wrong date'?'1999-01-01':customer.dateOfBirth,kind==='wrong balance'?1n:customer.balance,ledger));});
test('loading, ready and connection error states',async()=>{const states:string[]=[];await loadState(async()=>42,s=>states.push(s.status));assert.deepEqual(states,['loading','ready']);states.length=0;await loadState(async()=>{throw Error('RPC unavailable')},s=>{states.push(s.status);if(s.status==='error')assert.equal(s.error,'RPC unavailable')});assert.deepEqual(states,['loading','error']);assert.throws(()=>registryClient('javascript:void(0)','0x0000000000000000000000000000000000000001'));assert.throws(()=>registryClient('http://localhost','0x0'));});
test('public rendering includes required claim fields, exact USD, surplus and deficit',()=>{const s={claim:{finalized:true,totalEligibleAssetsUsd:12000000000n,totalLiabilitiesUsd:10000000000n,surplus:2000000000n,snapshotId:'epoch',rootHash:'root',snapshotTime:1000n,snapshotBlock:10n,submittedAt:1001n,liabilityVerifiedAt:1002n,finalizedAt:1003n,verifiedBy:'auditor',rateManifestHash:'manifest'},liability:{submittedAt:1001n},capacity:8,address:'contract',chainId:31337} as unknown as PublicSnapshot;const text=publicSummary(s);for(const field of ['SOLVENT','$120.00000000','$100.00000000','$20.00000000','120.00%','epoch','root','1000','1001','1002','1003','auditor','manifest','contract','31337'])assert.ok(text.includes(field));s.claim={...s.claim,totalEligibleAssetsUsd:9000000000n};assert.match(publicSummary(s),/INSOLVENT/);assert.match(publicSummary(s),/-\$10.00000000/);assert.equal(usd(1n),'$0.00000001');assert.equal(coverage(1n,0n),'No liabilities');});

test('exchange table preserves oracle precision independently of token decimals',()=>{
 const s={rates:[{token:'token',rate:1234567890123456789n,oracleDecimals:18,tokenDecimals:6,roundId:7n,updatedAt:1000n},{token:'other',rate:250000000000n,oracleDecimals:8,tokenDecimals:18,roundId:8n,updatedAt:1000n},{token:'whole',rate:2n,oracleDecimals:0,roundId:9n,updatedAt:1000n}]} as unknown as PublicSnapshot;
 assert.deepEqual(exchangeRateRows(s).map(row=>row[1]),['$1.234567890123456789','$2500','$2']);
 assert.equal(exchangeRateRows(s)[0][2],'#7');
 assert.equal(exchangeRateRows(s)[0][3],'1970-01-01 00:16:40 UTC');
 assert.deepEqual(exchangeRateRows({rates:[]} as unknown as PublicSnapshot),[]);
});
test('customer USD input converts to exact fixed-point units',()=>{
 assert.equal(parseUsdInput('125.50'),12550000000n);
 assert.equal(parseUsdInput('0.00000001'),1n);
 assert.equal(parseUsdInput('12'),1200000000n);
 assert.throws(()=>parseUsdInput('1.123456789'),/at most 8 decimal/);
 assert.throws(()=>parseUsdInput('-1'),/at most 8 decimal/);
 assert.throws(()=>parseUsdInput('01.00'),/at most 8 decimal/);
});
