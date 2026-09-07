import { Barretenberg, BackendType, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileCircuit } from './compile.ts';
import { build, hashing, hexField, randomField } from './tree.ts';
import type { InputMap } from '@noir-lang/noir_js';

export async function generateProof(inputs:InputMap) {
  const circuit=await compileCircuit();
  const {witness}=await new Noir(circuit).execute(inputs);
  const bb=await Barretenberg.new({backend:BackendType.Wasm,threads:1,srsSize:131072,crsPath:'artifacts/crs'});
  try {
    const backend=new UltraHonkBackend(circuit.bytecode,bb);
    const options={verifierTarget:'evm' as const};
    const proof=await backend.generateProof(witness,options);
    if(!await backend.verifyProof(proof,options))throw Error('proof rejected');
    return {proof:`0x${Buffer.from(proof.proof).toString('hex')}` as const,publicInputs:proof.publicInputs};
  } finally {await bb.destroy();}
}

export async function demoProof() {
  const circuit = await compileCircuit();
  const api = await hashing();
  const context = {epoch:1n,chain:31337n,registry:123n};
  const records = [100n,200n,300n,400n].map((balance,i)=>({id:BigInt(i+1),salt:randomField(),balance}));
  const tree = await build(api, records, context);
  await api.destroy();
  const inputs = {root:tree.root.hash.toString(),total:'1000',assets:'2000',epoch:'1',chain:'31337',registry:'123',
    ids:records.map(r=>r.id.toString()),salts:records.map(r=>r.salt.toString()),balances:records.map(r=>r.balance.toString())};
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);
  console.log('Witness constraints satisfied');
  const bb = await Barretenberg.new({backend:BackendType.Wasm,threads:1,srsSize:131072,crsPath:'artifacts/crs'});
  try {
    const backend = new UltraHonkBackend(circuit.bytecode,bb);
    const options = {verifierTarget:'evm' as const};
    const proof = await backend.generateProof(witness,options);
    if (!await backend.verifyProof(proof,options)) throw Error('proof verification failed');
    const vk = await backend.getVerificationKey(options);
    const verifier = await backend.getSolidityVerifier(vk,options);
    mkdirSync('contracts/generated',{recursive:true});
    writeFileSync('contracts/generated/NoirVerifier.sol',verifier);
    writeFileSync('artifacts/zk/proof.json',JSON.stringify({proof:`0x${Buffer.from(proof.proof).toString('hex')}`,publicInputs:proof.publicInputs}));
    writeFileSync('artifacts/zk/vk.bin',vk);
    console.log('Real EVM-target ZK proof verified; Solidity verifier generated',hexField(tree.root.hash));
  } finally { await bb.destroy(); }
}
if (process.argv[1]?.endsWith('/prove.ts')) await demoProof();
