import {createPublicClient,http,isAddress,type Address,type Hex} from 'viem';
import {minimumAbi} from './minimumAbi.ts';
import {audit,parse,verify,type Bundle,type Ledger,type Anchor} from '../../prover/minimum/tree.ts';
import {manifestHash,toUsd,type Rate} from '../../prover/minimum/oracle.ts';
export function registryClient(rpc:string,address:Address) {
 if(!isAddress(address)) throw Error('Invalid contract address');const url=new URL(rpc);if(!['http:','https:'].includes(url.protocol))throw Error('Invalid RPC URL');
 const client=createPublicClient({transport:http(rpc)});
 const read=<N extends 'currentClaim'|'capacity'|'maxOracleAge'|'assetCount'|'snapshotCount'|'auditor'|'company'>(functionName:N,blockNumber:bigint)=>client.readContract({address,abi:minimumAbi,functionName,blockNumber});
 return {
  client,address,
  async current() {
   const blockNumber=await client.getBlockNumber({cacheTime:0});
   const [claim,capacity,maxAge,chainId]=await Promise.all([read('currentClaim',blockNumber),read('capacity',blockNumber),read('maxOracleAge',blockNumber),client.getChainId()]);
   if(!claim.finalized)throw Error('No finalized claim is available');
   const [rates,observations,liability]=await Promise.all([
    client.readContract({address,abi:minimumAbi,functionName:'getRates',args:[claim.snapshotId],blockNumber}),
    client.readContract({address,abi:minimumAbi,functionName:'getClaimAssets',args:[claim.snapshotId],blockNumber}),
    client.readContract({address,abi:minimumAbi,functionName:'getLiability',args:[claim.snapshotId],blockNumber})]);
   const assets=await Promise.all(observations.map(async o=>({...o,asset:await client.readContract({address,abi:minimumAbi,functionName:'getAsset',args:[o.assetId],blockNumber})})));
   // All reads use one block to avoid mixing state across epochs.
   return {claim,rates,assets,liability,capacity:Number(capacity),maxAge,chainId,address,blockNumber};
  },
  async auditQueue() {
   const blockNumber=await client.getBlockNumber({cacheTime:0});const [count,snapshots,auditor,company]=await Promise.all([read('assetCount',blockNumber),read('snapshotCount',blockNumber),read('auditor',blockNumber),read('company',blockNumber)]);
   const assets=[];for(let id=1n;id<=count;id++)assets.push({id,...await client.readContract({address,abi:minimumAbi,functionName:'getAsset',args:[id],blockNumber})});
   const liabilities=[];for(let i=0n;i<snapshots;i++){const id=await client.readContract({address,abi:minimumAbi,functionName:'snapshotIds',args:[i],blockNumber});const [liability,rates,proposal]=await Promise.all([client.readContract({address,abi:minimumAbi,functionName:'getLiability',args:[id],blockNumber}),client.readContract({address,abi:minimumAbi,functionName:'getRates',args:[id],blockNumber}),client.readContract({address,abi:minimumAbi,functionName:'getClaimProposal',args:[id],blockNumber})]);liabilities.push({id,liability,rates,proposal});}
   return {assets,liabilities,auditor,company};
  },
  async ledger(snapshot:Hex,rootHash:Hex,rootSum:bigint,capacity:number):Promise<Ledger> {
   const logs=await client.getContractEvents({address,abi:minimumAbi,eventName:'PublicLedger',args:{snapshotId:snapshot},fromBlock:0n,toBlock:'latest',strict:true});if(logs.length!==1)throw Error('Public ledger event not found or ambiguous');
   const e=logs[0].args;const ledger:Ledger={version:1,snapshotId:snapshot,capacity,padding:'trailing-domain-v1',rootHash,rootSum,pairs:e.identities.map((identity,i)=>({identity,amount:e.amounts[i]}))};if(!audit(ledger))throw Error('Public ledger does not match the on-chain root and sum');return ledger;
  }
 };
}
export type PublicSnapshot=Awaited<ReturnType<ReturnType<typeof registryClient>['current']>>;
export const anchor=(s:PublicSnapshot):Anchor=>({snapshotId:s.claim.snapshotId,rootHash:s.claim.rootHash,rootSum:s.claim.totalLiabilitiesUsd,capacity:s.capacity});
export function usd(value:bigint):string {const sign=value<0n?'-':'';const n=value<0n?-value:value;return `${sign}$${n/100000000n}.${(n%100000000n).toString().padStart(8,'0')}`;}
export function coverage(assets:bigint,liabilities:bigint):string {if(liabilities===0n)return 'No liabilities';const bps=assets*10000n/liabilities;return `${bps/100n}.${(bps%100n).toString().padStart(2,'0')}%`;}
export function publicSummary(s:PublicSnapshot):string {
 const c=s.claim,solvent=c.totalEligibleAssetsUsd>=c.totalLiabilitiesUsd;
 return `${solvent?'SOLVENT':'INSOLVENT'} at snapshot\nEligible assets: ${usd(c.totalEligibleAssetsUsd)}\nLiabilities: ${usd(c.totalLiabilitiesUsd)}\nSurplus / deficit: ${usd(c.totalEligibleAssetsUsd-c.totalLiabilitiesUsd)}\nCoverage: ${coverage(c.totalEligibleAssetsUsd,c.totalLiabilitiesUsd)}\nEpoch: ${c.snapshotId}\nRoot: ${c.rootHash}\nSnapshot: ${c.snapshotTime} (Unix seconds), block ${c.snapshotBlock}\nLiability submitted: ${s.liability.submittedAt}\nClaim submitted: ${c.submittedAt}\nLiability verified: ${c.liabilityVerifiedAt}\nClaim verified: ${c.finalizedAt}\nAuditor: ${c.verifiedBy} — approved\nManifest: ${c.rateManifestHash}\nCapacity: ${s.capacity} pairs\nContract: ${s.address}\nNetwork chain ID: ${s.chainId}`;
}
export function checkPublicCalculation(s:PublicSnapshot):boolean {
 try {const rates=s.rates.map(r=>({...r})) as Rate[];if(manifestHash(s.claim.snapshotId,rates,s.claim.snapshotTime,s.maxAge)!==s.claim.rateManifestHash)return false;
 const total=s.assets.reduce((n,a)=>{const r=rates[Number(a.rateIndex)];if(!r || r.token.toLowerCase()!==a.asset.token.toLowerCase() || r.feed.toLowerCase()!==a.asset.feed.toLowerCase())throw Error('rate mismatch');const value=toUsd(a.rawAmount,r,s.claim.snapshotTime,s.maxAge,'down');if(value!==a.usd)throw Error('valuation mismatch');return n+value;},0n);
 return total===s.claim.totalEligibleAssetsUsd && s.claim.surplus===total-s.claim.totalLiabilitiesUsd;
 }catch{return false;}
}
export async function retrieveProof(token:string,fetcher:typeof fetch=fetch):Promise<Bundle> {
 if(!/^[0-9a-f]{64}$/.test(token))throw Error('Enter the prototype access token');
 const response=await fetcher('/api/proof',{method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error(response.status===401?'Authentication failed or token expired':'Proof retrieval failed');
 const text=await response.text();if(text.length>262144)throw Error('Oversized bundle');return parse<Bundle>(text);
}
export function localResult(bundle:Bundle,customerId:string,dateOfBirth:string,balance:bigint,current:Anchor):string {
 if(bundle.snapshotId!==current.snapshotId)return 'OUTDATED EPOCH: retrieve a proof for the current on-chain snapshot.';
 if(!verify(bundle,{customerId,dateOfBirth,balance},current))throw Error('Invalid proof, identity or independently known full balance');
 return `VALID: ${usd(balance)} included in epoch ${current.snapshotId}. All parts verified locally.`;
}
export async function loadState<T>(load:()=>Promise<T>,render:(state:{status:'loading'|'ready'|'error';value?:T;error?:string})=>void) {render({status:'loading'});try{render({status:'ready',value:await load()});}catch(error){render({status:'error',error:error instanceof Error?error.message:String(error)});}}
