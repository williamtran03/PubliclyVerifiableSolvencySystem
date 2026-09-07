import {readFileSync} from 'node:fs';
import {createPublicClient,createWalletClient,http,parseAbi,toHex,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
// Explicit, local-only RPC helper. Signing key is supplied by the developer,
// never embedded in source or printed. No mainnet deployment is performed.
const abi=parseAbi(['function beginSnapshot(bytes32,uint128) returns (uint256)','function submitProof(uint256,bytes)',
  'function snapshots(uint256) view returns (bytes32,uint128,uint128,uint64,uint64,bool,bool)']);
const [mode,address,epochText,path]=process.argv.slice(2);
const rpc=process.env.RPC_URL??'http://127.0.0.1:8545';
const u=new URL(rpc);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('this helper supports local RPC only');
if(!process.env.PRIVATE_KEY)throw Error('set PRIVATE_KEY for your local development account');
const account=privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const publicClient=createPublicClient({transport:http(rpc)});
const chainId=await publicClient.getChainId();if(chainId!==31337)throw Error('expected local chain 31337');
const wallet=createWalletClient({account,transport:http(rpc)});
const p=JSON.parse(readFileSync(path,'utf8'));const epoch=BigInt(epochText);
if(mode==='begin') {
  const root=p.commitment??toHex(BigInt(p.root.hash),{size:32});
  const total=BigInt(p.total??p.root.sum);
  const hash=await wallet.writeContract({chain:null,address:address as Hex,abi,functionName:'beginSnapshot',args:[root,total]});
  const receipt=await publicClient.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('begin reverted');
  console.log('Snapshot:',await publicClient.readContract({address:address as Hex,abi,functionName:'snapshots',args:[epoch]}));
} else if(mode==='submit') {
  const hash=await wallet.writeContract({chain:null,address:address as Hex,abi,functionName:'submitProof',args:[epoch,p.encoded??p.proof]});
  const receipt=await publicClient.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('verification reverted');console.log('Verified snapshot transaction',hash);
} else throw Error('Usage: begin|submit registry-address epoch public-or-proof.json');
