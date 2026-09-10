import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {MockOracle,manifestHash,toUsd,type Rate} from '../prover/minimum/oracle.ts';
import {buildSnapshot,type LiabilityCustomer} from '../prover/minimum/pipeline.ts';
import {audit,parse,stringify,verify,type Ledger,type Bundle} from '../prover/minimum/tree.ts';
import type {Hex} from 'viem';
const [command,inputFile,out]=process.argv.slice(2);
if(command==='build') {
 const input=parse<{snapshotId:Hex;snapshotTime:bigint;snapshotBlock:string;maxAge:string;capacity:number;minParts:number;maxParts:number;rates:Rate[];customers:LiabilityCustomer[]}>(await readFile(inputFile,'utf8'));
 if(!out || !isAbsolute(out))throw Error('Provide a new absolute output directory outside the repository');
 const project=await realpath('.');const parent=await realpath(resolve(out,'..'));const rel=relative(project,parent);if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Private output must be outside repository');
 const result=await buildSnapshot(input.customers,new MockOracle(input.rates),input.snapshotId,input.snapshotTime,BigInt(input.maxAge),input.capacity,input.minParts,input.maxParts,input.rates);
 await mkdir(out,{mode:0o700});await mkdir(resolve(out,'private'),{mode:0o700});
 await writeFile(resolve(out,'ledger.json'),stringify(result.ledger),{flag:'wx'});await writeFile(resolve(out,'rates.json'),stringify(result.manifest),{flag:'wx'});
 await writeFile(resolve(out,'submission.json'),stringify({id:input.snapshotId,rootHash:result.ledger.rootHash,totalLiabilitiesUsd:result.ledger.rootSum,rateManifestHash:result.rateManifestHash,snapshotTime:input.snapshotTime,snapshotBlock:input.snapshotBlock}),{flag:'wx'});
 await writeFile(resolve(out,'private/conversions.private.json'),stringify(result.conversions),{flag:'wx',mode:0o600});
 for(const [i,b] of result.bundles.entries())await writeFile(resolve(out,`private/customer-${i}.private.json`),stringify(b),{flag:'wx',mode:0o600});
 console.log('Built snapshot. Publish only ledger.json, rates.json and submission.json. Keep private/ confidential.');
} else if(command==='audit') {
 const ledger=parse<Ledger>(await readFile(inputFile,'utf8'));if(!audit(ledger))throw Error('Invalid ledger');console.log(`Valid ledger: root ${ledger.rootHash}, total ${ledger.rootSum}, capacity ${ledger.capacity}, public parts ${ledger.pairs.length}`);
} else if(command==='audit-private') {
 // Auditor receives independent source records and the company's output through a private channel.
 const input=parse<{snapshotId:Hex;snapshotTime:bigint;maxAge:string;rates:Rate[];customers:LiabilityCustomer[]}>(await readFile(inputFile,'utf8'));if(!out)throw Error('Provide output directory');
 const ledger=parse<Ledger>(await readFile(resolve(out,'ledger.json'),'utf8'));if(!audit(ledger)||ledger.snapshotId!==input.snapshotId)throw Error('Ledger mismatch');
 const rates=parse<Rate[]>(await readFile(resolve(out,'rates.json'),'utf8'));const manifest=manifestHash(input.snapshotId,rates,input.snapshotTime,BigInt(input.maxAge));const submission=JSON.parse(await readFile(resolve(out,'submission.json'),'utf8'));if(manifest!==submission.rateManifestHash)throw Error('Manifest mismatch');
 let total=0n;const identities=new Set<string>();for(const [i,c] of input.customers.entries()){if(identities.has(c.customerId))throw Error('Duplicate source customer');identities.add(c.customerId);let balance=0n;for(const h of c.holdings){const r=rates.find(r=>r.token.toLowerCase()===h.token.toLowerCase());if(!r)throw Error('Missing rate');balance+=toUsd(h.rawAmount,r,input.snapshotTime,BigInt(input.maxAge));}const bundle=parse<Bundle>(await readFile(resolve(out,`private/customer-${i}.private.json`),'utf8'));if(!verify(bundle,{customerId:c.customerId,dateOfBirth:c.dateOfBirth,balance},ledger))throw Error('Customer mismatch');total+=balance;}
 if(total!==ledger.rootSum)throw Error('Source-record total mismatch');console.log(`Verified ${input.customers.length} source customers, total ${total}. Auditor must still establish source-record completeness and check rates against trusted feeds.`);
} else throw Error('Usage: npm run minimum -- build <private-input.json> <new-absolute-directory> | audit <ledger.json> | audit-private <independent-private-input.json> <output-directory>');
