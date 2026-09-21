import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters } from "viem";
import { readEpoch } from "./chain.ts";

test("epoch count and snapshot are read at the same block", async () => {
 const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async (_input,init)=>{
  const request=JSON.parse(String(init?.body));
  let result;
  if(request.method==="eth_blockNumber")result="0x42";
  else {
   assert.equal(request.params[1],"0x42");
   result=++calls===1?encodeAbiParameters([{type:"uint256"}],[2n]):encodeAbiParameters(
    [{type:"uint256"},{type:"uint256"},{type:"uint64[3]"},{type:"uint256[3]"},{type:"uint256[3]"},{type:"uint80[3]"},{type:"uint256"},{type:"uint64"}],
    [123n,456n,[1n,2n,3n],[4n,5n,6n],[1n,1n,1n],[1n,1n,1n],15n,100n]);
  }
  return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result}),{headers:{"content-type":"application/json"}});
 };
 try { const epoch=await readEpoch({rpcUrl:"https://rpc.test",registry:"0x1111111111111111111111111111111111111111"});assert.equal(epoch.epochId,1n);assert.equal(epoch.rootHash,123n);assert.equal(calls,2); }
 finally {globalThis.fetch=original;}
});
