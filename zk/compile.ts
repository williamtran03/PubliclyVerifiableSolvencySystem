import { compile_program, createFileManager } from '@noir-lang/noir_wasm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function compileCircuit() {
  const { program } = await compile_program(createFileManager(resolve('circuits/solvency')));
  mkdirSync('artifacts/zk', { recursive: true });
  writeFileSync('artifacts/zk/circuit.json', JSON.stringify(program));
  return program;
}
if (process.argv[1]?.endsWith('/compile.ts')) await compileCircuit();
