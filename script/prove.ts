/**
 * Builds the tree, proves it well-formed in Noir, and writes everything the
 * contract needs.
 *
 *   customers.csv -> tree -> Prover.toml -> nargo execute -> bb prove
 *                                                        -> fixtures/zk-proof.json
 *                                                        -> contracts/HonkVerifier.sol
 *
 * Usage: npx tsx script/prove.ts [--skip-verifier]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toHex } from "viem";
import { readCustomersCsv } from "../prover/csv.ts";
import { poseidonHash } from "../prover/hash.ts";
import { buildTree } from "../prover/merkleSumTree.ts";
import { LEAVES } from "../prover/circuit.ts";

const circuitDir = "circuits/solvency";
const targetDir = `${circuitDir}/target`;

function run(command: string, args: string[], cwd?: string): void {
  try {
    execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `${command} not found. Install the circuit toolchain:\n` +
          "  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup -v 1.0.0-beta.26\n" +
          "  curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash && bbup -v 6.0.0-nightly.20260902",
      );
    }
    throw error;
  }
}

/** bb writes field elements as raw 32-byte big-endian words. */
function readFieldElements(path: string): bigint[] {
  const bytes = readFileSync(path);
  const values: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 32) {
    values.push(BigInt(`0x${bytes.subarray(i, i + 32).toString("hex")}`));
  }
  return values;
}

const entries = readCustomersCsv("./prover/customers.csv");
const tree = buildTree(entries, poseidonHash);

if (tree.leaves.length !== LEAVES) {
  throw new Error(
    `the circuit is compiled for ${LEAVES} leaves but this customer list needs ${tree.leaves.length}. ` +
      `Change LEAVES in circuits/solvency/src/main.nr and prover/circuit.ts, then re-run — ` +
      `the verification key changes with it.`,
  );
}

console.log("1. witness");
writeFileSync(
  `${circuitDir}/Prover.toml`,
  [
    `ids = [${tree.leaves.map((leaf) => `"${leaf.id}"`).join(", ")}]`,
    `balances = [${tree.leaves.map((leaf) => `"${leaf.balance}"`).join(", ")}]`,
    `root_hash = "${tree.root.hash}"`,
    `total_liabilities = "${tree.root.sum}"`,
    "",
  ].join("\n"),
);
run("nargo", ["execute"], circuitDir);

console.log("\n2. proof");
run("bb", [
  "prove",
  "--verifier_target", "evm",
  "--write_vk",
  "-b", `${targetDir}/solvency.json`,
  "-w", `${targetDir}/solvency.gz`,
  "-o", targetDir,
]);

const publicInputs = readFieldElements(`${targetDir}/public_inputs`);
if (publicInputs.length !== 2) {
  throw new Error(`expected 2 public inputs, got ${publicInputs.length}`);
}
// The circuit and the TypeScript prover computed the root independently. If
// these disagree, one of the two Poseidon implementations drifted.
if (publicInputs[0] !== tree.root.hash || publicInputs[1] !== tree.root.sum) {
  throw new Error(
    `circuit disagrees with the prover:\n` +
      `  root:  circuit ${publicInputs[0]} vs prover ${tree.root.hash}\n` +
      `  total: circuit ${publicInputs[1]} vs prover ${tree.root.sum}`,
  );
}

const proof = readFileSync(`${targetDir}/proof`);
mkdirSync("fixtures", { recursive: true });
writeFileSync(
  "fixtures/zk-proof.json",
  JSON.stringify(
    {
      rootHash: tree.root.hash.toString(),
      totalLiabilities: tree.root.sum.toString(),
      publicInputs: publicInputs.map((value) => toHex(value, { size: 32 })),
      proof: toHex(proof),
    },
    null,
    2,
  ) + "\n",
);

if (!process.argv.includes("--skip-verifier")) {
  console.log("\n3. solidity verifier");
  run("bb", [
    "write_solidity_verifier",
    "--verifier_target", "evm",
    "-k", `${targetDir}/vk`,
    "-o", "contracts/HonkVerifier.sol",
  ]);
}

console.log(`\nroot:              ${tree.root.hash}`);
console.log(`total liabilities: ${tree.root.sum} wei`);
console.log(`proof:             ${proof.length} bytes -> fixtures/zk-proof.json`);
if (!existsSync("contracts/HonkVerifier.sol")) {
  console.log("verifier:          missing — re-run without --skip-verifier");
}
