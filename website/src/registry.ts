import { createPublicClient, http, isAddress, parseAbi } from 'viem';
export type Snapshot = { rootHash: bigint; liabilities: bigint; assets: bigint; epoch: bigint; timestamp: bigint; block: bigint; chain: number; address: string; demo: boolean };
const abi = parseAbi([
 'function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint64 timestamp)',
 'function totalReserves() view returns (uint256)',
 'function epochCount() view returns (uint256)',
 'function verifier() view returns (address)',
]);
export async function readSnapshot(endpoint: string, address: string, chain: string): Promise<Snapshot> {
  const url = new URL(endpoint);
  if (url.username || url.password) throw new Error('Do not place credentials in the RPC address.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for a remote RPC, or HTTP for a local development node.');
  if (!isAddress(address)) throw new Error('Enter a valid Ethereum registry address.');
  if (!/^[1-9]\d{0,14}$/.test(chain)) throw new Error('Enter the expected numeric chain ID.');
  const client = createPublicClient({transport:http(endpoint, {timeout:12000,retryCount:0})});
  const actualChain = await client.getChainId();
  if (actualChain !== Number(chain)) throw new Error(`Wrong network: this RPC reports chain ${actualChain}, but you expected ${chain}.`);
  const block = await client.getBlockNumber();
  const code = await client.getCode({address,blockNumber:block});
  if(!code || code==='0x') throw new Error('There is no contract at this address on the selected chain.');
  const [epoch,assets,count,verifier] = await Promise.all([
    client.readContract({address,abi,functionName:'currentEpoch',blockNumber:block}),
    client.readContract({address,abi,functionName:'totalReserves',blockNumber:block}),
    client.readContract({address,abi,functionName:'epochCount',blockNumber:block}),
    client.readContract({address,abi,functionName:'verifier',blockNumber:block}),
  ]);
  if(count===0n)throw new Error('This registry has not published an epoch yet.');
  if(verifier==='0x0000000000000000000000000000000000000000')throw new Error('This registry has no configured verifier.');
  return {rootHash:epoch[0],liabilities:epoch[1],timestamp:BigInt(epoch[2]),assets,epoch:count-1n,block,chain:actualChain,address,demo:false};
}
