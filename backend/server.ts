import {createServer, type IncomingMessage} from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {readFile, stat, realpath} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse, stringify, type Bundle} from '../prover/minimum/tree.ts';

export type Account = {tokenHash: string; customerId: string; bundleFile: string; expiresAt: number};
export interface AuthenticationAdapter { authenticate(req: IncomingMessage): Promise<Account | undefined> }
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
/** Prototype bearer adapter: administrator distributes a random, expiring token out of band. */
export class PrototypeAuthentication implements AuthenticationAdapter {
  constructor(private accounts: Account[]) {}
  async authenticate(req: IncomingMessage) {
    const header=req.headers.authorization;
    if (!header || !/^Bearer [0-9a-f]{64}$/.test(header)) return;
    const hash=Buffer.from(tokenHash(header.slice(7)),'hex');
    return this.accounts.find(a=>a.expiresAt>Date.now() && /^[0-9a-f]{64}$/.test(a.tokenHash) && timingSafeEqual(hash,Buffer.from(a.tokenHash,'hex')));
  }
}
export function proofServer(auth: AuthenticationAdapter, privateDirectory: string) {
  const root=realpathSync(privateDirectory);
  const project=realpathSync(resolve(import.meta.dirname,'..')),location=relative(project,root);
  if(!location.startsWith('..')&&!isAbsolute(location))throw Error('Private proof directory must be outside the repository');
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json');
    // No customer ID, file name, query parameter or request body selects a bundle.
    if (req.url!='/api/proof' || req.method!=='GET') {res.writeHead(404);res.end('{"error":"Not found"}');return;}
    try {
      const account=await auth.authenticate(req);
      if (!account) {res.writeHead(401);res.end('{"error":"Authentication required"}');return;}
      const file=resolve(root,account.bundleFile),rel=relative(root,file);
      if(rel.startsWith('..') || isAbsolute(rel) || !rel) throw Error('path');
      const canonical=await realpath(file),canonicalRel=relative(root,canonical);
      if(canonicalRel.startsWith('..') || isAbsolute(canonicalRel) || !canonicalRel) throw Error('path');
      if((await stat(canonical)).size>262144) throw Error('size');
      const bundle=parse<Bundle>(await readFile(canonical,'utf8'));
      if(bundle.customerId!==account.customerId) throw Error('account mapping');
      res.end(stringify(bundle));
    } catch {res.writeHead(500);res.end('{"error":"Proof unavailable"}');}
  });
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const directory=process.env.MINIMUM_PRIVATE_DIR;
  if(!directory || !isAbsolute(directory)) throw Error('Set MINIMUM_PRIVATE_DIR to an absolute directory outside the frontend/project');
  const accounts=JSON.parse(await readFile(resolve(directory,'accounts.private.json'),'utf8')) as Account[];
  const server=proofServer(new PrototypeAuthentication(accounts),directory);
  server.listen(Number(process.env.PORT??8787),'127.0.0.1',()=>console.log('Prototype proof backend: http://127.0.0.1:8787 (loopback only)'));
}
