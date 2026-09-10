import {createWalletClient,custom,isAddress,type Address,type Hex,type EIP1193Provider} from 'viem';
import {registryClient,anchor,publicSummary,claimOverview,exchangeRateRows,checkPublicCalculation,retrieveProof,localResult,loadState,usd,coverage,parseUsdInput,type PublicSnapshot} from './minimumClient.ts';
import {minimumAbi} from './minimumAbi.ts';
import {stringify} from '../../prover/minimum/tree.ts';
document.querySelectorAll('section.card')[2]?.setAttribute('id','account');
document.querySelector('details.card')?.setAttribute('id','operations');
const input=(id:string)=>(document.getElementById(id) as HTMLInputElement).value;
const output=(id:string,text:string)=>{document.getElementById(id)!.textContent=text;};
const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
const connection=()=>registryClient(input('rpcUrl'),input('registryAddress') as Address);
let snapshot:PublicSnapshot|undefined;let generation=0;
const claimValue=(label:string,value:string)=>{const box=document.createElement('div');box.className='claim-figure';const l=document.createElement('span');l.className='claim-label';l.textContent=label;const v=document.createElement('strong');v.textContent=value;box.append(l,v);return box;};
function renderClaim(s:PublicSnapshot){
 const c=s.claim,solvent=c.totalEligibleAssetsUsd>=c.totalLiabilitiesUsd,root=document.getElementById('epochResult')!;root.replaceChildren();
 const status=document.createElement('div');status.className=`claim-status ${solvent?'is-solvent':'is-insolvent'}`;const dot=document.createElement('span');dot.className='claim-dot';const title=document.createElement('strong');title.textContent=solvent?'SOLVENT':'INSOLVENT';const date=document.createElement('span');date.textContent=`Published snapshot · ${new Date(Number(c.snapshotTime)*1000).toLocaleString()}`;status.append(dot,title,date);
 const figures=document.createElement('div');figures.className='claim-figures';figures.append(claimValue('Eligible assets',usd(c.totalEligibleAssetsUsd)),claimValue('Liabilities',usd(c.totalLiabilitiesUsd)),claimValue('Surplus / deficit',usd(c.totalEligibleAssetsUsd-c.totalLiabilitiesUsd)),claimValue('Coverage',coverage(c.totalEligibleAssetsUsd,c.totalLiabilitiesUsd)));root.append(status,figures);
}
document.querySelector('details summary')?.insertAdjacentHTML('afterend','<p class="note technical-note">These details expose the hashes, timestamps, oracle manifest, reserve observations and ledger arithmetic used to reproduce the public claim independently.</p>');
const balanceInput=document.getElementById('fullBalance') as HTMLInputElement|null;const balanceLabel=balanceInput?.parentElement;if(balanceLabel){balanceLabel.childNodes[0].textContent='Full USD balance: ';balanceInput.placeholder='125.50';balanceInput.removeAttribute('inputmode');}
function clearClaimDetails() {
 output('rates','');output('claimDetails','');output('reserveDetails','');output('ledgerResult','');
 const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=4;cell.textContent='No exchange rates loaded.';row.append(cell);document.getElementById('rates')!.append(row);
}
function renderRates(s:PublicSnapshot) {
 const body=document.getElementById('rates')!;body.replaceChildren();
 const head=body.closest('table')?.querySelector('thead tr');if(head&&!head.querySelector('[data-oracle-round]')){const cell=document.createElement('th');cell.dataset.oracleRound='';cell.scope='col';cell.textContent='Oracle round';head.insertBefore(cell,head.lastElementChild);}
 for(const values of exchangeRateRows(s)) {const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
 if(!s.rates.length){const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=4;cell.textContent='No exchange rates published.';row.append(cell);body.append(row);}
}

for(const id of ['rpcUrl','registryAddress'])document.getElementById(id)!.addEventListener('input',()=>{generation++;snapshot=undefined;clearClaimDetails();button('verifyBtn').disabled=true;button('auditLedger').disabled=true;output('verifyResult','');output('epochResult','Connection changed; read the claim again.');});
button('connectBtn').onclick=async()=>{
 const version=++generation;snapshot=undefined;clearClaimDetails();button('verifyBtn').disabled=true;button('auditLedger').disabled=true;output('verifyResult','');output('epochResult','Reading claim…');
 await loadState(()=>connection().current(),state=>{if(version!==generation)return;if(state.status==='loading')output('connection','Reading contract…');else if(state.status==='error'){output('connection',`ERROR: ${state.error}`);output('epochResult','No claim loaded.');}else{snapshot=state.value!;output('connection','Connected. Values read at block '+snapshot.blockNumber);renderClaim(snapshot);output('claimDetails',publicSummary(snapshot));output('reserveDetails',stringify({oracleRates:snapshot.rates,reserveObservations:snapshot.assets}));renderRates(snapshot);button('verifyBtn').disabled=false;button('auditLedger').disabled=false;}});
};
button('auditLedger').onclick=async()=>{try{const s=await connection().current();output('ledgerResult','Recomputing…');const ledger=await connection().ledger(s.claim.snapshotId,s.claim.rootHash,s.claim.totalLiabilitiesUsd,s.capacity);if(!checkPublicCalculation(s))throw Error('Manifest or USD arithmetic mismatch');output('ledgerResult',`VALID public ledger: ${ledger.pairs.length} real parts, ${ledger.capacity} capacity. Root, total and asset conversions match.\n${stringify(ledger)}`);}catch(e){output('ledgerResult',`ERROR: ${e instanceof Error?e.message:e}`);}};
button('verifyBtn').onclick=async()=>{
 const version=generation;const client=connection();const token=input('accessToken');(document.getElementById('accessToken') as HTMLInputElement).value='';
 const customer=input('customerId'),dob=input('dateOfBirth'),expected=input('fullBalance');button('verifyBtn').disabled=true;output('verifyResult','Retrieving your bundle…');
 try{const expectedUnits=parseUsdInput(expected);const bundle=await retrieveProof(token);const current=await client.current();if(version!==generation)throw Error('Connection changed; verify again');output('verifyResult',localResult(bundle,customer,dob,expectedUnits,anchor(current)));}catch(e){output('verifyResult',`INVALID: ${e instanceof Error?e.message:e}`);}finally{button('verifyBtn').disabled=!snapshot;}
};
button('refreshAudit').onclick=async()=>{await loadState(()=>connection().auditQueue(),s=>output('auditQueue',s.status==='ready'?stringify(s.value):s.status==='loading'?'Reading proposals…':`ERROR: ${s.error}`));};
button('auditorSubmit').onclick=async()=>{
 try{const provider=(window as Window & {ethereum?:EIP1193Provider}).ethereum;if(!provider)throw Error('Connect an injected wallet');const c=connection();const wallet=createWalletClient({transport:custom(provider)});const [account]=await wallet.requestAddresses();const auditor=await c.client.readContract({address:c.address,abi:minimumAbi,functionName:'auditor'});if(account.toLowerCase()!==auditor.toLowerCase())throw Error('Wallet is not the appointed auditor');if(await wallet.getChainId()!==await c.client.getChainId())throw Error('Wallet network differs from RPC');
 const action=input('auditAction'),id=input('actionId'),approved=input('decision')==='true';let hash:Hex;
 if(action==='finalizeClaim'&&approved){const queue=await c.auditQueue();const selected=queue.liabilities.find(l=>l.id.toLowerCase()===id.toLowerCase());if(!(selected?.review as {readyForReserveAttestation?:boolean})?.readyForReserveAttestation)throw Error('Historical reserve, timestamp, eligibility, freshness or solvency checks failed. Refresh the auditor queue.');}

 if(action==='approveAsset'||action==='verifyRemoveAsset'){if(!/^[1-9][0-9]*$/.test(id))throw Error('Invalid asset ID');hash=await wallet.writeContract({address:c.address,abi:minimumAbi,functionName:action,args:[BigInt(id),approved],account,chain:null});}
 else if(action==='verifyAddLiability'||action==='verifyRemoveLiability'||action==='finalizeClaim'){if(!/^0x[0-9a-f]{64}$/i.test(id))throw Error('Invalid snapshot ID');hash=await wallet.writeContract({address:c.address,abi:minimumAbi,functionName:action,args:[id as Hex,approved],account,chain:null});}else throw Error('Unknown action');
 output('auditResult','Submitted '+hash);const receipt=await c.client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Transaction reverted');output('auditResult','Confirmed '+hash);
 }catch(e){output('auditResult',`ERROR: ${e instanceof Error?e.message:e}`);}
};
