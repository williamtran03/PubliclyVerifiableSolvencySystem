import solc from 'solc';
import { createVM } from '@ethereumjs/vm';
import { createCustomCommon, Mainnet, Hardfork } from '@ethereumjs/common';
import { createAccount, createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, type Abi, type Hex } from 'viem';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export function compileSolidity() {
  const sources:{[key:string]:{content:string}}={};
  function walk(path:string) {for(const f of readdirSync(path,{withFileTypes:true})) {
    const p=join(path,f.name);if(f.isDirectory())walk(p);else if(p.endsWith('.sol'))sources[p]={content:readFileSync(p,'utf8')};
  }}walk('contracts');
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:false,
    evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.bytecode.linkReferences','evm.deployedBytecode.object']}}}})));
  const errors=output.errors?.filter((e:{severity:string})=>e.severity==='error');if(errors?.length)throw Error(JSON.stringify(errors));
  return output.contracts as {[file:string]:{[name:string]:{abi:Abi;evm:{bytecode:{object:string;linkReferences:{[file:string]:{[name:string]:{start:number;length:number}[]}}};deployedBytecode:{object:string}}}}};
}
export async function evm() {
  const common=createCustomCommon({chainId:31337},Mainnet,{hardfork:Hardfork.Cancun});
  const vm=await createVM({common});
  const owner=createAddressFromString('0x1000000000000000000000000000000000000001');
  await vm.stateManager.putAccount(owner,createAccount({balance:10n**24n}));
  const contracts=compileSolidity();
  const libraries=new Map<string,Hex>();
  async function deploy(file:string,name:string,args:readonly unknown[]=[]):Promise<{address:Hex;abi:Abi}> {
    const artifact=contracts[file][name];
    let bytecode=artifact.evm.bytecode.object;
    for(const [f,refs] of Object.entries(artifact.evm.bytecode.linkReferences))for(const [n,offsets]of Object.entries(refs)) {
      const key=`${f}:${n}`;if(!libraries.has(key))libraries.set(key,(await deploy(f,n)).address);
      const address=libraries.get(key)!.slice(2);
      for(const offset of offsets)bytecode=bytecode.slice(0,2*offset.start)+address+bytecode.slice(2*(offset.start+offset.length));
    }
    const data=encodeDeployData({abi:artifact.abi,bytecode:`0x${bytecode}`,args});
    const result=await vm.evm.runCall({caller:owner,data:hexToBytes(data),gasLimit:100_000_000n});
    if(result.execResult.exceptionError)throw Error(`deploy ${name}: ${result.execResult.exceptionError.error}`);
    if(!result.createdAddress)throw Error('no deployed address');
    return {address:result.createdAddress.toString() as Hex,abi:artifact.abi};
  }
  async function call(c:{address:Hex;abi:Abi},name:string,args:readonly unknown[]=[],value=0n,caller=owner) {
    const data=name?encodeFunctionData({abi:c.abi,functionName:name,args}):'0x';
    const r=await vm.evm.runCall({caller,to:createAddressFromString(c.address),data:hexToBytes(data),value,gasLimit:100_000_000n});
    if(r.execResult.exceptionError)throw Error(`revert ${name}: ${bytesToHex(r.execResult.returnValue)}`);
    return {gas:r.execResult.executionGasUsed,value:r.execResult.returnValue.length?decodeFunctionResult({abi:c.abi,functionName:name,data:bytesToHex(r.execResult.returnValue)}):undefined};
  }
  return {vm,owner,contracts,deploy,call};
}
