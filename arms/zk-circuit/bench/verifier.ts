import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { keccak256, encodePacked, type Hex } from "viem";
import { mainNr, mainNrFlat, NARGO_TOML, benchHoldings, proverToml, depthOf } from "./generate.ts";

export const SEED = keccak256(encodePacked(["string"], ["solvency bench seed"])) as Hex;
export const CONTEXT = 7n;
const EIP170 = 24576;
const RESULTS = "arms/zk-circuit/bench/verifier.json";
const NUM_ASSETS = 3;

const sh = (cmd: string, args: string[], cwd: string) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

const PROBE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {HonkVerifier, IVerifier} from "../src/Verifier.sol";

contract VerifierGas is Test {
    function test_VerifyGas() public {
        IVerifier verifier = IVerifier(address(new HonkVerifier()));
        bytes memory proof = vm.readFileBinary("proof.bin");
        uint256[] memory words = vm.parseJsonUintArray(vm.readFile("inputs.json"), ".inputs");
        bytes32[] memory publicInputs = new bytes32[](words.length);
        for (uint256 i = 0; i < words.length; i++) {
            publicInputs[i] = bytes32(words[i]);
        }

        uint256 before = gasleft();
        bool ok = verifier.verify(proof, publicInputs);
        uint256 used = before - gasleft();
        assertTrue(ok, "proof did not verify");
        console.log("VERIFY_GAS", used);
        console.log("CALLDATA_BYTES", proof.length + publicInputs.length * 32);
    }
}
`;

const FOUNDRY = `[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
solc = "0.8.28"
evm_version = "osaka"
fs_permissions = [{ access = "read", path = "./" }]

[fmt]
ignore = ["src/Verifier.sol"]
`;

export type VerifierRow = {
  n: number;
  form: "chained" | "flat";
  assets?: number;
  paddedN?: number;
  logN?: number;
  publicInputSlots?: number;
  runtimeBytes?: number;
  eip170MarginBytes?: number;
  deployable?: boolean;
  verifyGas?: number;
  calldataBytes?: number;
  proofBytes?: number;
  error?: string;
};

export function build(n: number, form: "chained" | "flat", dir: string, assets: number = NUM_ASSETS): VerifierRow {
  const row: VerifierRow = assets === NUM_ASSETS ? { n, form } : { n, form, assets };
  const circuit = join(dir, "circuit");
  const project = join(dir, "project");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(circuit, "src"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(circuit, "Nargo.toml"), NARGO_TOML);
  writeFileSync(join(circuit, "src", "main.nr"), (form === "flat" ? mainNrFlat : mainNr)(n, assets));
  writeFileSync(join(circuit, "Prover.toml"), proverToml(benchHoldings(n, SEED, assets), CONTEXT, assets));

  const bytecode = join(circuit, "target", "circuit_bench.json");
  const steps: [string, string[]][] = [
    ["nargo", ["execute"]],
    ["bb", ["write_vk", "-s", "ultra_honk", "-b", bytecode, "-o", "target/vk", "--oracle_hash", "keccak"]],
    ["bb", ["prove", "-s", "ultra_honk", "-b", bytecode, "-w", "target/circuit_bench.gz",
            "-o", "target/proof", "-k", "target/vk/vk", "--oracle_hash", "keccak"]],
    ["bb", ["write_solidity_verifier", "-k", "target/vk/vk", "-o", "../project/src/Verifier.sol", "-t", "evm"]],
  ];
  for (const [cmd, args] of steps) {
    const out = sh(cmd, args, circuit);
    if (out.status !== 0) return { ...row, error: `${cmd} ${args[0]}: ${(out.stderr || out.stdout).trim().slice(-400)}` };
  }

  mkdirSync(join(project, "test"), { recursive: true });
  writeFileSync(join(project, "foundry.toml"), FOUNDRY);
  writeFileSync(join(project, "test", "VerifierGas.t.sol"), PROBE);
  const proof = readFileSync(join(circuit, "target", "proof", "proof"));
  writeFileSync(join(project, "proof.bin"), proof);
  row.proofBytes = proof.length;

  const raw = readFileSync(join(circuit, "target", "proof", "public_inputs"));
  const inputs: string[] = [];
  for (let i = 0; i < raw.length; i += 32) inputs.push(BigInt(`0x${raw.subarray(i, i + 32).toString("hex")}`).toString());
  if (inputs.length !== assets + 2) return { ...row, error: `expected ${assets + 2} public inputs, got ${inputs.length}` };
  writeFileSync(join(project, "inputs.json"), JSON.stringify({ inputs }));

  mkdirSync(join(project, "lib"), { recursive: true });
  sh("ln", ["-sfn", join(process.cwd(), "lib", "forge-std"), join(project, "lib", "forge-std")], project);

  const source = readFileSync(join(project, "src", "Verifier.sol"), "utf8");
  const constant = (name: string) => Number(source.match(new RegExp(`uint256 constant ${name} = (\\d+);`))?.[1]) || undefined;
  row.paddedN = constant("N");
  row.logN = constant("LOG_N");
  row.publicInputSlots = constant("NUMBER_OF_PUBLIC_INPUTS");

  const sizes = sh("forge", ["build", "--sizes", "--json"], project);
  try {
    const parsed = JSON.parse(sizes.stdout.slice(sizes.stdout.indexOf("{")));
    row.runtimeBytes = (parsed as Record<string, { runtime_size?: number }>).HonkVerifier?.runtime_size;
  } catch {
    row.runtimeBytes = undefined;
  }
  if (row.runtimeBytes === undefined) {
    return { ...row, error: `could not read the verifier size: ${(sizes.stderr || sizes.stdout).trim().slice(-400)}` };
  }
  row.eip170MarginBytes = EIP170 - row.runtimeBytes;
  row.deployable = row.runtimeBytes <= EIP170;

  const test = sh("forge", ["test", "--match-test", "test_VerifyGas", "-vv"], project);
  row.verifyGas = Number(test.stdout.match(/VERIFY_GAS\s+(\d+)/)?.[1]) || undefined;
  row.calldataBytes = Number(test.stdout.match(/CALLDATA_BYTES\s+(\d+)/)?.[1]) || undefined;
  if (row.verifyGas === undefined) {
    row.error = (test.stdout.match(/\[FAIL[^\]]*\][^\n]*/)?.[0] ?? test.stderr.trim().slice(-300)) || "no gas reported";
  }
  return row;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sizes = (process.env.BENCH_N?.split(",").map((s) => Number(s.trim())) ?? [8, 128, 2048]).filter((n) => n > 1);
  const form = (process.env.BENCH_FORM as "chained" | "flat") ?? "chained";
  const dir = join(tmpdir(), "solvency-bench-verifier");
  const rows: VerifierRow[] = [];

  console.log(`Generating the Solidity verifier at N = ${sizes.join(", ")} (${form} form)\n`);
  for (const n of sizes) {
    process.stdout.write(`N = ${String(n).padStart(6)} (depth ${depthOf(n)}) … `);
    const row = build(n, form, dir);
    rows.push(row);
    console.log(
      row.runtimeBytes === undefined
        ? `FAILED — ${row.error}`
        : `2^${row.logN} padded  runtime ${row.runtimeBytes.toLocaleString()} B ` +
          `(EIP-170 margin ${row.eip170MarginBytes! >= 0 ? "+" : ""}${row.eip170MarginBytes!.toLocaleString()} B` +
          `${row.deployable ? "" : ", NOT DEPLOYABLE"})  proof ${row.proofBytes} B  ` +
          (row.verifyGas ? `verify ${row.verifyGas.toLocaleString()} gas` : `verify n/a — ${row.error}`),
    );
    writeFileSync(RESULTS, JSON.stringify({ measuredAt: new Date().toISOString(), eip170: EIP170, rows }, null, 2) + "\n");
  }
  console.log(`\nWrote ${RESULTS}`);
}
