import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {demoSetup,type SRS} from './kzg.ts';
import {prove,verify,verifyCustomer,commitmentHash,encodeProof,type Proof} from './protocol.ts';
const json=(x:unknown)=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v,2);
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const srs=(p:string):SRS=>{const s=read(p);return {g1:s.g1.map((p:string[])=>p.map(BigInt)),g2:s.g2.map((p:string[])=>p.map(BigInt))};};
const [command,file,contextPath,srsPath,out='artifacts/snarkless']=process.argv.slice(2);
if(command==='demo-setup') {
  if(!file)throw Error('output path required');
  mkdirSync('artifacts',{recursive:true});writeFileSync(file,json(demoSetup()));
  console.log('LOCAL DEMO SRS ONLY. A trusted multiparty ceremony is required for real use.');
} else if(command==='prove') {
  const c=read(contextPath);const ctx={epoch:BigInt(c.epoch),chain:BigInt(c.chain),registry:BigInt(c.registry),assets:BigInt(c.assets)};
  const customers=(read(file) as {id:string;balance:string}[]).map(r=>({id:BigInt(r.id),balance:BigInt(r.balance)}));
  const {proof,total,inclusions}=prove(customers,ctx,srs(srsPath));
  mkdirSync(out,{recursive:true,mode:0o700});
  writeFileSync(join(out,'public.json'),json({context:ctx,total,commitment:commitmentHash(proof.commitments),proof,encoded:encodeProof(proof)}));
  inclusions.forEach((p,i)=>writeFileSync(join(out,`customer-${i}.json`),json(p),{mode:0o600}));
} else if(command==='verify') {
  const p=read(file);const proof:Proof={commitments:p.proof.commitments.map((x:string[])=>x.map(BigInt)),degrees:p.proof.degrees.map((x:string[])=>x.map(BigInt)),
    values:p.proof.values.map(BigInt),openings:p.proof.openings.map((x:string[])=>x.map(BigInt)),sumProof:p.proof.sumProof.map(BigInt)};
  const ctx={epoch:BigInt(p.context.epoch),chain:BigInt(p.context.chain),registry:BigInt(p.context.registry),assets:BigInt(p.context.assets)};
  if(!verify(proof,BigInt(p.total),ctx,srs(contextPath)))throw Error('invalid proof');
  console.log('Proof valid. Independently match commitment, context, assets and SRS to the deployed registry.');
} else if(command==='verify-customer') {
  const i=read(file),pub=read(contextPath),s=srs(srsPath);
  const inclusion={index:i.index,customer:{id:BigInt(i.customer.id),balance:BigInt(i.customer.balance)},balance:i.balance.map(BigInt),identity:i.identity.map(BigInt)};
  if(!verifyCustomer(inclusion,pub.proof.commitments.map((p:string[])=>p.map(BigInt)),inclusion.customer,s))throw Error('invalid inclusion');
  console.log('Included. Compare this ID and balance with your own account records:',i.customer);
} else throw Error('Usage: demo-setup out.json | prove records.json context.json srs.json [outdir] | verify public.json srs.json | verify-customer customer.json trusted-public.json srs.json');
