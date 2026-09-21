import './style.css';
import { demoProof, parseProof, serialize, verifyInclusion, VerificationError, type Proof } from './verify';
import { readSnapshot, type Snapshot } from './registry';
const $ = <T extends HTMLElement=HTMLElement>(id:string) => document.getElementById(id) as T;
const input = (id:string) => $<HTMLInputElement>(id);
const text = (id:string, value:string) => {$(id).textContent=value;};
const example=demoProof();
let snapshot:Snapshot|null=null, proof:Proof|null=null, request=0, fileRequest=0;
const format=(n:bigint)=>n.toLocaleString('en-US');
function route(name:string){const view=['snapshot','balance','method'].includes(name)?name:'snapshot';document.querySelectorAll<HTMLElement>('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function go(view:string){location.hash=view;route(view);}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go!)));
window.addEventListener('hashchange',()=>route(location.hash.slice(1)));route(location.hash.slice(1));
function resetResult(){ $('result-panel').classList.remove('success','failed');text('result-title','Ready when you are.');text('result-description','Select a proof and enter the balance you expect. A valid path alone does not tell us whether the amount is correct.');['identity','path','snapshot'].forEach((s,i)=>{$(`check-${s}`).classList.remove('passed');$(`check-${s}`).querySelector('span')!.textContent=`0${i+1}`;});}
function invalidate(){snapshot=null;resetResult();text('assets-value','—');text('liabilities-value','—');text('root-value','No snapshot selected');text('position-title','Waiting for a registry snapshot.');text('position-detail','Verification is unavailable until the selected registry has been read successfully.');text('epoch-value','—');text('time-value','—');text('block-value','—');text('coverage-text','No snapshot selected');text('surplus-text','');$('coverage-fill').style.width='0%';text('selected-context','No snapshot selected. Read a registry or choose the example.');$<HTMLButtonElement>('verify-button').disabled=true;}
function render(s:Snapshot){snapshot=s;resetResult();$<HTMLButtonElement>('verify-button').disabled=false;
 text('mode-label',s.demo?'DEMONSTRATION':'CONNECTED · READ ONLY');document.querySelector('.mode-bar')!.classList.toggle('live',!s.demo);
 text('mode-note',s.demo?'Sample ledger. No live company or deployed contract is being assessed.':'Values reported by your selected registry and RPC. Confirm their identity independently.');
 text('snapshot-badge',s.demo?'EXAMPLE DATA':`READ AT BLOCK ${s.block}`);text('assets-label',s.demo?'Example reserves':'Reserves at read block');text('assets-value',format(s.assets));text('liabilities-value',format(s.liabilities));
 const covers=s.assets>=s.liabilities;
 document.querySelector('.relation')!.textContent=covers?'≥':'<';
 const ratio=s.assets===0n?null:s.liabilities*10000n/s.assets;
 $('coverage-fill').style.width=ratio===null?(s.liabilities===0n?'0%':'100%'):`${Math.min(Number(ratio),10000)/100}%`;
 $('coverage-fill').style.background=covers?'#3d796d':'#b44435';
 text('coverage-text',ratio===null?'Coverage ratio unavailable · zero reserves':`Liabilities / reserves · ${(Number(ratio)/100).toFixed(2)}%`);text('surplus-text',`Difference · ${format(s.assets-s.liabilities)} wei`);
 document.querySelector('.coverage-track')!.setAttribute('aria-label',$('coverage-text').textContent!);
 text('position-stamp',s.demo?'EXAMPLE':'OBSERVATION');
 text('position-title',s.demo?'The example reserves cover the committed total.':covers?'Current reported reserves cover the last committed total.':'Current reported reserves are below the last committed total.');
 text('position-detail',s.demo?'This demonstrates the comparison. It is not evidence about a real custodian.':'Reserves are read now; liabilities belong to the recorded epoch. These may describe different moments. No claim is made about undisclosed obligations.');
 text('epoch-value',s.demo?'Demo / eight-leaf tree':`Epoch ${s.epoch}`);
 text('time-value',s.demo?'Illustrative data · no chain timestamp':new Date(Number(s.timestamp)*1000).toLocaleString());text('block-value',s.demo?'Not connected':`${s.block} / chain ${s.chain}`);
 text('root-value',s.rootHash.toString());text('selected-context',s.demo?'Demonstration snapshot':`Chain ${s.chain} · epoch ${s.epoch} · ${s.address}`);
}
function useDemo(){request++;$<HTMLButtonElement>('connect-button').disabled=false;render({rootHash:example.rootHash,liabilities:example.rootSum,assets:60000n,epoch:0n,timestamp:0n,block:0n,chain:0,address:'',demo:true});text('connection-feedback','Example selected. No blockchain request was made.');$('connection-feedback').classList.remove('error');}
$('use-demo').addEventListener('click',useDemo);
$('connect-form').addEventListener('submit',async event=>{event.preventDefault();const ticket=++request;invalidate();text('connection-feedback','Reading the registry at a single block…');$('connection-feedback').classList.remove('error');$<HTMLButtonElement>('connect-button').disabled=true;
 try{const s=await readSnapshot(input('rpc').value.trim(),input('registry').value.trim(),input('chain').value.trim());if(ticket!==request)return;render(s);text('connection-feedback','Snapshot loaded. Reads were pinned to the same block.');}
 catch(error){if(ticket!==request)return;text('connection-feedback',error instanceof Error?error.message.split('\n')[0]:'Unable to read the registry. Check the network and address.');$('connection-feedback').classList.add('error');text('mode-label','NOT CONNECTED');text('mode-note','The connection failed. No snapshot is selected. Check your connection details or return to the example.');text('snapshot-badge','NO SNAPSHOT SELECTED');}
 finally{if(ticket===request)$<HTMLButtonElement>('connect-button').disabled=false;}
});
input('proof-file').addEventListener('change',async()=>{const ticket=++fileRequest;proof=null;resetResult();const file=input('proof-file').files?.[0];if(!file){text('file-feedback','No file selected.');return;}
 try{if(file.size>262144)throw new Error('Maximum file size is 256 KB.');const contents=await file.text();if(ticket!==fileRequest)return;proof=parseProof(contents);text('file-feedback',`${file.name} · read locally`);$('file-feedback').classList.remove('error');}
 catch(error){if(ticket!==fileRequest)return;text('file-feedback',error instanceof Error?error.message:'Unable to read this proof.');$('file-feedback').classList.add('error');}
});
$('load-example').addEventListener('click',()=>{useDemo();fileRequest++;input('proof-file').value='';proof=parseProof(serialize(example));input('username').value='customer-123';input('balance').value='12550';text('file-feedback','Example customer loaded locally. Balance: 12,550 wei.');$('file-feedback').classList.remove('error');});
for(const id of ['username','balance'])input(id).addEventListener('input',resetResult);
$('proof-form').addEventListener('submit',event=>{event.preventDefault();resetResult();try{if(!snapshot)throw new Error('Select a snapshot first.');if(!proof)throw new Error('Choose a proof file or load the example first.');verifyInclusion(proof,input('username').value.trim(),input('balance').value.trim(),snapshot);
 $('result-panel').classList.add('success');text('result-title',snapshot.demo?'Example balance verified.':'Your balance is included.');text('result-description',`${format(proof.entry.balance)} wei for ${proof.entry.username} matches your input and the selected root and total.${snapshot.demo?' This is a demonstration, not a live solvency claim.':''}`);
 for(const step of ['identity','path','snapshot']){$(`check-${step}`).classList.add('passed');$(`check-${step}`).querySelector('span')!.textContent='✓';}
 }catch(error){$('result-panel').classList.add('failed');text('result-title','Verification did not pass.');text('result-description',error instanceof Error?error.message:'Unable to verify this proof.');if(error instanceof VerificationError)$(`check-${error.step}`).querySelector('span')!.textContent='×';}});
$('copy-root').addEventListener('click',async()=>{if(!snapshot){text('connection-feedback','Select a snapshot before copying its root.');return;}try{await navigator.clipboard.writeText(snapshot.rootHash.toString());text('copy-root','Copied');setTimeout(()=>text('copy-root','Copy'),1500);}catch{text('connection-feedback','Clipboard unavailable. Select and copy the root directly.');}});
useDemo();

for(const id of ['rpc','registry','chain']) input(id).addEventListener('input',()=>{
 request++;
 invalidate();
 $<HTMLButtonElement>('connect-button').disabled=false;
 text('connection-feedback','Connection changed. Read the registry again.');
 text('mode-label','NOT CONNECTED');
 text('mode-note','The connection details changed. Read the selected registry before verifying.');
 text('snapshot-badge','NO SNAPSHOT SELECTED');
});
