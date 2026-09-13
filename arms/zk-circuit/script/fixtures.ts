import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const NUM_ASSETS = 3;
const PROOF_DIR = "./arms/zk-circuit/circuit/target/proof";

const publicInputs = readFileSync(`${PROOF_DIR}/public_inputs`);
const words: bigint[] = [];
for (let i = 0; i < publicInputs.length; i += 32) {
  words.push(BigInt(`0x${publicInputs.subarray(i, i + 32).toString("hex")}`));
}

if (words.length !== NUM_ASSETS + 2) {
  throw new Error(`expected ${NUM_ASSETS + 2} public inputs, got ${words.length}`);
}

mkdirSync("./arms/zk-circuit/fixtures", { recursive: true });
copyFileSync(`${PROOF_DIR}/proof`, "./arms/zk-circuit/fixtures/proof.bin");
writeFileSync(
  "./arms/zk-circuit/fixtures/epoch.json",
  JSON.stringify(
    {
      floors: words.slice(0, NUM_ASSETS).map(String),
      context: words[NUM_ASSETS].toString(),
      rootHash: words[NUM_ASSETS + 1].toString(),
    },
    null,
    2,
  ) + "\n",
);

console.log("Wrote arms/zk-circuit/fixtures/proof.bin + arms/zk-circuit/fixtures/epoch.json");
