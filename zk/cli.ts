import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {build,hashing,randomField,verifyInclusion,type Context,type Record,type Inclusion,type Node} from './tree.ts';
import {generateProof} from './prove.ts';
const json=(x:unknown)=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v,2);
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const [command,file,contextPath,out='artifacts/customer-snapshot']=process.argv.slice(2);
if(command==='prepare') {
  const rows=read(file) as {id:string;balance:string;salt?:string}[];
  const context=read(contextPath) as {epoch:string;chain:string;registry:string;assets:string};
  const ctx:Context={epoch:BigInt(context.epoch),chain:BigInt(context.chain),registry:BigInt(context.registry)};
  const records:Record[]=rows.map(r=>({id:BigInt(r.id),balance:BigInt(r.balance),salt:r.salt?BigInt(r.salt):randomField()}));
  const api=await hashing();
  try {
    const tree=await build(api,records,ctx);
    if(tree.root.sum>BigInt(context.assets))throw Error('insolvent');
    mkdirSync(out,{recursive:true,mode:0o700});
    const input={...context,root:tree.root.hash.toString(),total:tree.root.sum.toString(),
      ids:records.map(r=>r.id.toString()),salts:records.map(r=>r.salt.toString()),balances:records.map(r=>r.balance.toString())};
    writeFileSync(join(out,'private-input.json'),json(input),{mode:0o600});
    writeFileSync(join(out,'public.json'),json({...ctx,root:tree.root,assets:context.assets}));
    for(let i=0;i<4;i++)writeFileSync(join(out,`customer-${i}.json`),json({index:i,record:records[i],siblings:[tree.leaves[i^1],tree.middle[(i>>1)^1]]}),{mode:0o600});
    console.log('Prepared snapshot; distribute each customer file privately. Confirm the on-chain assets before proving.');
  } finally {await api.destroy();}
} else if(command==='prove') {
  const p=await generateProof(read(file));writeFileSync(contextPath??'artifacts/zk/proof.json',json(p));
} else if(command==='verify-customer') {
  // contextPath must be independently fetched/pinned from the registry, NOT trusted
  // merely because it came with the customer proof.
  const raw=read(file);const pub=read(contextPath);
  const p:Inclusion={index:raw.index,record:{id:BigInt(raw.record.id),salt:BigInt(raw.record.salt),balance:BigInt(raw.record.balance)},
    siblings:raw.siblings.map((s:{hash:string;sum:string})=>({hash:BigInt(s.hash),sum:BigInt(s.sum)}))};
  const ctx={epoch:BigInt(pub.epoch),chain:BigInt(pub.chain),registry:BigInt(pub.registry)};
  const root:Node={hash:BigInt(pub.root.hash),sum:BigInt(pub.root.sum)};
  const api=await hashing();try {if(!await verifyInclusion(api,p,ctx,root))throw Error('invalid inclusion');console.log('Included; also compare the displayed ID and balance with your own records.',raw.record.id,raw.record.balance);}finally{await api.destroy();}
} else throw Error('Usage: prepare records.json context.json [outdir] | prove private-input.json [proof.json] | verify-customer customer.json trusted-public.json');
