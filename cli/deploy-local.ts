import {createPublicClient,createWalletClient,http,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileSolidity} from '../testing/evm.ts';

const [variant,srsPath]=process.argv.slice(2);
if(!['zk','snarkless'].includes(variant))throw Error('Usage: deploy-local.ts zk | snarkless srs.json');
const rpc=process.env.RPC_URL??'http://127.0.0.1:8545';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(rpc).hostname))throw Error('local RPC required');
if(!process.env.PRIVATE_KEY)throw Error('set PRIVATE_KEY to a local development key');
const account=privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const pc=createPublicClient({transport:http(rpc)});if(await pc.getChainId()!==31337)throw Error('expected chain 31337');
const wc=createWalletClient({account,transport:http(rpc)});
const contracts=compileSolidity();const deployed=new Map<string,Hex>();
async function deploy(file:string,name:string,args:readonly unknown[]=[]):Promise<Hex> {
  const a=contracts[file][name];let bytecode=a.evm.bytecode.object;
  for(const [f,refs]of Object.entries(a.evm.bytecode.linkReferences))for(const [n,offsets]of Object.entries(refs)) {
    const key=`${f}:${n}`;if(!deployed.has(key))deployed.set(key,await deploy(f,n));
    for(const o of offsets)bytecode=bytecode.slice(0,o.start*2)+deployed.get(key)!.slice(2)+bytecode.slice((o.start+o.length)*2);
  }
  const hash=await wc.deployContract({chain:null,abi:a.abi,bytecode:`0x${bytecode}`,args});
  const receipt=await pc.waitForTransactionReceipt({hash});
  if(receipt.status!=='success'||!receipt.contractAddress)throw Error(`deploy ${name} failed`);
  console.log(name,receipt.contractAddress);return receipt.contractAddress;
}
let verifier:Hex;
if(variant==='zk')verifier=await deploy('contracts/generated/NoirVerifier.sol','HonkVerifier');
else {
  if(!srsPath)throw Error('a pinned SRS file is required');
  const s=JSON.parse(readFileSync(srsPath,'utf8'));
  verifier=await deploy('contracts/SnarklessVerifier.sol','SnarklessVerifier',[s.g2.map((p:string[])=>p.map(BigInt))]);
}
const name=variant==='zk'?'ZkSolvencyVault':'SnarklessSolvencyVault';
const vault=await deploy(`contracts/${name}.sol`,name,[verifier]);
writeFileSync('local-deployment.json',JSON.stringify({chainId:31337,verifier,vault,libraries:Object.fromEntries(deployed)},null,2));
