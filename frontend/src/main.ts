import {createWalletClient,custom,isAddress,type Address,type Hex,type EIP1193Provider} from 'viem';
import {registryClient,anchor,publicSummary,checkPublicCalculation,retrieveProof,localResult,loadState,type PublicSnapshot} from './minimumClient.ts';
import {minimumAbi} from './minimumAbi.ts';
import {stringify} from '../../prover/minimum/tree.ts';
const input=(id:string)=>(document.getElementById(id) as HTMLInputElement).value;
const output=(id:string,text:string)=>{document.getElementById(id)!.textContent=text;};
const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
const connection=()=>registryClient(input('rpcUrl'),input('registryAddress') as Address);
let snapshot:PublicSnapshot|undefined;let generation=0;
for(const id of ['rpcUrl','registryAddress'])document.getElementById(id)!.addEventListener('input',()=>{generation++;snapshot=undefined;button('verifyBtn').disabled=true;button('auditLedger').disabled=true;output('verifyResult','');output('epochResult','Connection changed; read the claim again.');});
button('connectBtn').onclick=async()=>{
 const version=++generation;snapshot=undefined;button('verifyBtn').disabled=true;button('auditLedger').disabled=true;output('verifyResult','');
 await loadState(()=>connection().current(),state=>{if(version!==generation)return;if(state.status==='loading')output('connection','Reading contract…');else if(state.status==='error'){output('connection',`ERROR: ${state.error}`);output('epochResult','No claim loaded.');}else{snapshot=state.value!;output('connection','Connected. Values read at block '+snapshot.blockNumber);output('epochResult',publicSummary(snapshot));output('rates',stringify({oracleRates:snapshot.rates,reserveObservations:snapshot.assets}));button('verifyBtn').disabled=false;button('auditLedger').disabled=false;}});
};
button('auditLedger').onclick=async()=>{try{const s=await connection().current();output('ledgerResult','Recomputing…');const ledger=await connection().ledger(s.claim.snapshotId,s.claim.rootHash,s.claim.totalLiabilitiesUsd,s.capacity);if(!checkPublicCalculation(s))throw Error('Manifest or USD arithmetic mismatch');output('ledgerResult',`VALID public ledger: ${ledger.pairs.length} real parts, ${ledger.capacity} capacity. Root, total and asset conversions match.\n${stringify(ledger)}`);}catch(e){output('ledgerResult',`ERROR: ${e instanceof Error?e.message:e}`);}};
button('verifyBtn').onclick=async()=>{
 const version=generation;const client=connection();const token=input('accessToken');(document.getElementById('accessToken') as HTMLInputElement).value='';
 const customer=input('customerId'),dob=input('dateOfBirth'),expected=input('fullBalance');button('verifyBtn').disabled=true;output('verifyResult','Retrieving your bundle…');
 try{if(!/^(0|[1-9][0-9]{0,77})$/.test(expected))throw Error('Enter an unsigned full balance in 1e-8 USD units');const bundle=await retrieveProof(token);const current=await client.current();if(version!==generation)throw Error('Connection changed; verify again');output('verifyResult',localResult(bundle,customer,dob,BigInt(expected),anchor(current)));}catch(e){output('verifyResult',`INVALID: ${e instanceof Error?e.message:e}`);}finally{button('verifyBtn').disabled=!snapshot;}
};
button('refreshAudit').onclick=async()=>{await loadState(()=>connection().auditQueue(),s=>output('auditQueue',s.status==='ready'?stringify(s.value):s.status==='loading'?'Reading proposals…':`ERROR: ${s.error}`));};
button('auditorSubmit').onclick=async()=>{
 try{const provider=(window as Window & {ethereum?:EIP1193Provider}).ethereum;if(!provider)throw Error('Connect an injected wallet');const c=connection();const wallet=createWalletClient({transport:custom(provider)});const [account]=await wallet.requestAddresses();const auditor=await c.client.readContract({address:c.address,abi:minimumAbi,functionName:'auditor'});if(account.toLowerCase()!==auditor.toLowerCase())throw Error('Wallet is not the appointed auditor');if(await wallet.getChainId()!==await c.client.getChainId())throw Error('Wallet network differs from RPC');
 const action=input('auditAction'),id=input('actionId'),approved=input('decision')==='true';let hash:Hex;
 if(action==='approveAsset'||action==='verifyRemoveAsset'){if(!/^[1-9][0-9]*$/.test(id))throw Error('Invalid asset ID');hash=await wallet.writeContract({address:c.address,abi:minimumAbi,functionName:action,args:[BigInt(id),approved],account,chain:null});}
 else if(action==='verifyAddLiability'||action==='verifyRemoveLiability'||action==='finalizeClaim'){if(!/^0x[0-9a-f]{64}$/i.test(id))throw Error('Invalid snapshot ID');hash=await wallet.writeContract({address:c.address,abi:minimumAbi,functionName:action,args:[id as Hex,approved],account,chain:null});}else throw Error('Unknown action');
 output('auditResult','Submitted '+hash);const receipt=await c.client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Transaction reverted');output('auditResult','Confirmed '+hash);
 }catch(e){output('auditResult',`ERROR: ${e instanceof Error?e.message:e}`);}
};
