import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {proofServer,PrototypeAuthentication,tokenHash,type Account} from './server.ts';
import {build} from '../prover/minimum/build.ts';
import {stringify} from '../prover/minimum/tree.ts';
test('HTTP authentication boundary returns only the mapped private bundle and rejects enumeration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'minimum-auth-'));const token='ab'.repeat(32);const {bundles}=build([{customerId:'alice',dateOfBirth:'2000-01-01',balance:100n},{customerId:'bob',dateOfBirth:'1990-01-01',balance:200n}],`0x${'01'.repeat(32)}`);
 const accounts:Account[]=[{tokenHash:tokenHash(token),customerId:'alice',bundleFile:'alice.private.json',expiresAt:Date.now()+60000}];await writeFile(join(dir,'alice.private.json'),stringify(bundles[0]));await writeFile(join(dir,'bob.private.json'),stringify(bundles[1]));
 const server=proofServer(new PrototypeAuthentication(accounts),dir);server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;
 try {
 assert.equal((await fetch(url+'/api/proof')).status,401);assert.equal((await fetch(url+'/api/proof',{headers:{Authorization:'Bearer '+'00'.repeat(32)}})).status,401);
 for(const path of ['/api/proof?customerId=bob','/api/proof/bob','/private/bob.private.json','/accounts.private.json'])assert.equal((await fetch(url+path,{headers:{Authorization:`Bearer ${token}`}})).status,404);
 const response=await fetch(url+'/api/proof',{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const text=await response.text();assert.equal(JSON.parse(text).customerId,'alice');assert.ok(!text.includes('bob'));
 accounts[0].customerId='bob';assert.equal((await fetch(url+'/api/proof',{headers:{Authorization:`Bearer ${token}`}})).status,500);accounts[0].customerId='alice';accounts[0].expiresAt=0;assert.equal((await fetch(url+'/api/proof',{headers:{Authorization:`Bearer ${token}`}})).status,401);
 assert.equal((await fetch(url+'/api/proof',{method:'POST',body:'private identity'})).status,404);
 } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

test('backend refuses a private store inside the public project',()=>{assert.throws(()=>proofServer(new PrototypeAuthentication([]),'.'),/outside the repository/);});

test('backend rejects a bundle symlink escaping the private store',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'minimum-symlink-'));
 const outside=await mkdtemp(join(tmpdir(),'minimum-outside-'));
 const token='cd'.repeat(32);
 const {bundles}=build([{customerId:'alice',dateOfBirth:'2000-01-01',balance:100n}],`0x${'02'.repeat(32)}`);
 await writeFile(join(outside,'alice.json'),stringify(bundles[0]));
 await symlink(join(outside,'alice.json'),join(dir,'alice.json'));
 const server=proofServer(new PrototypeAuthentication([{tokenHash:tokenHash(token),customerId:'alice',bundleFile:'alice.json',expiresAt:Date.now()+60000}]),dir);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/proof`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,500);assert.equal(await response.text(),'{"error":"Proof unavailable"}');
 } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
