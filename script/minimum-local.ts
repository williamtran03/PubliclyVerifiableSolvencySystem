import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createPublicClient,createWalletClient,http,type Address,type Hex,type Abi} from 'viem';
import {minimumAbi} from '../frontend/src/minimumAbi.ts';
import {MockOracle,type Rate} from '../prover/minimum/oracle.ts';
import {buildSnapshot} from '../prover/minimum/pipeline.ts';
import {stringify} from '../prover/minimum/tree.ts';
import {tokenHash} from '../backend/server.ts';
export const NATIVE='0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;
export async function localSetup(rpc='http://127.0.0.1:8545') {
 const url=new URL(rpc);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Demo requires a loopback Anvil node');
 const client=createPublicClient({transport:http(rpc)}),wallet=createWalletClient({transport:http(rpc)});if(await client.getChainId()!==31337)throw Error('Demo requires chain 31337');
 const accounts=await wallet.getAddresses();if(accounts.length<3)throw Error('Three unlocked local accounts required');const [company,auditor,reserve]=accounts;
 const artifact=async(name:string)=>JSON.parse(await readFile(`out/${name}.sol/${name}.json`,'utf8')) as {abi:Abi;bytecode:{object:Hex}};
 async function deploy(name:string,args:unknown[]) {const a=await artifact(name);const hash=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args,account:company,chain:null});const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success'||!receipt.contractAddress)throw Error('Deployment failed');return receipt.contractAddress;}
 const feed=await deploy('MockOracle',[8]);const registry=await deploy('MinimumSolvencyRegistry',[company,auditor,16n,3600n]);
 const oracleArtifact=await artifact('MockOracle');const now=(await client.getBlock()).timestamp;
 await receipt(await wallet.writeContract({address:feed,abi:oracleArtifact.abi,functionName:'setRound',args:[1,2000n*10n**8n,now],account:company,chain:null}));
 async function receipt(hash:Hex) {const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error(`Transaction reverted: ${hash}`);return r;}
 async function send(account:Address,functionName:string,args:unknown[]) {return receipt(await wallet.writeContract({address:registry,abi:minimumAbi as Abi,functionName,args,account,chain:null,gas:10000000n}));}
 await send(company,'addAsset',[NATIVE,reserve,feed,true]);await send(reserve,'verifyAsset',[1n,now+3600n,'0x']);await send(auditor,'approveAsset',[1n,true]);
 const block=await client.getBlock();const rate:Rate={token:NATIVE,feed,tokenDecimals:18,oracleDecimals:8,rate:2000n*10n**8n,roundId:1n,updatedAt:now};
 // Rates must be pinned on-chain before proving; pin them here so every snapshot ID is self-contained.
 async function prepare(id:Hex,raw=50000000000000000n){let pinned=await client.readContract({address:registry,abi:minimumAbi as Abi,functionName:'getRates',args:[id]}) as Rate[];if(!pinned.length){await send(company,'pinRates',[id,block.timestamp,[rate]]);pinned=await client.readContract({address:registry,abi:minimumAbi as Abi,functionName:'getRates',args:[id]}) as Rate[];}return buildSnapshot([{customerId:'demo-alice',dateOfBirth:'2000-01-01',holdings:[{token:NATIVE,rawAmount:raw}]},{customerId:'demo-bob',dateOfBirth:'1990-02-02',holdings:[{token:NATIVE,rawAmount:25000000000000000n}]}],new MockOracle(pinned),id,block.timestamp,3600n,16,2,4);}
 async function submit(snapshot:Awaited<ReturnType<typeof prepare>>) {const l=snapshot.ledger;await send(company,'addLiability',[{id:l.snapshotId,rootHash:l.rootHash,totalLiabilitiesUsd:l.rootSum,rateManifestHash:snapshot.rateManifestHash,snapshotTime:block.timestamp,snapshotBlock:block.number},l.pairs.map(p=>p.identity),l.pairs.map(p=>p.amount)]);await send(auditor,'verifyAddLiability',[l.snapshotId,true]);}
 const snapshot=await prepare(`0x${randomBytes(32).toString("hex")}`);await submit(snapshot);
 const reserveBalance=await client.getBalance({address:reserve,blockNumber:block.number});await send(company,'proposeClaim',[snapshot.ledger.snapshotId,[1n],[reserveBalance]]);
 // Demonstration of the auditor's historical balance check before attesting.
 if(reserveBalance!==await client.getBalance({address:reserve,blockNumber:block.number}))throw Error('Snapshot balance mismatch');
 await send(auditor,'finalizeClaim',[snapshot.ledger.snapshotId,true]);
 return {client,wallet,company,auditor,reserve,registry,feed,block,rate,snapshot,prepare,submit,send,reserveBalance};
}
export async function writeDemo(directory:string,setup:Awaited<ReturnType<typeof localSetup>>) {
 const dir=resolve(directory),project=await realpath('.');await mkdir(dir,{recursive:true,mode:0o700});const actual=await realpath(dir),rel=relative(project,actual);if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Private output must be outside the repository');
 const accounts=[],credentials=[];for(const [i,bundle] of setup.snapshot.bundles.entries()){const token=randomBytes(32).toString('hex');const bundleFile=`customer-${i}.private.json`;await writeFile(resolve(dir,bundleFile),stringify(bundle),{mode:0o600,flag:'wx'});accounts.push({tokenHash:tokenHash(token),customerId:bundle.customerId,bundleFile,expiresAt:Date.now()+86400000});credentials.push({customerId:bundle.customerId,dateOfBirth:bundle.dateOfBirth,balance:bundle.expectedBalance,token});}
 await writeFile(resolve(dir,'accounts.private.json'),JSON.stringify(accounts),{mode:0o600,flag:'wx'});await writeFile(resolve(dir,'credentials.private.json'),stringify(credentials),{mode:0o600,flag:'wx'});await writeFile(resolve(dir,'conversions.private.json'),stringify(setup.snapshot.conversions),{mode:0o600,flag:'wx'});
 await writeFile(resolve(dir,'ledger.json'),stringify(setup.snapshot.ledger),{flag:'wx'});await writeFile(resolve(dir,'rates.json'),stringify(setup.snapshot.manifest),{flag:'wx'});
 console.log(`Registry: ${setup.registry}\nAuditor: ${setup.auditor}\nPrivate demo data: ${dir}\nCredentials expire in 24 hours; inspect credentials.private.json locally.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Usage: npm run demo:minimum -- /absolute/new/private-directory');await writeDemo(process.argv[2],await localSetup(process.env.RPC_URL));}
