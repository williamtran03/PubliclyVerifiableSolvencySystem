import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const NUM_ASSETS = 3;
const PROOF_DIR = "./circuits/multi-asset/target/proof";

const publicInputs = readFileSync(`${PROOF_DIR}/public_inputs`);
const words: bigint[] = [];
for (let i = 0; i < publicInputs.length; i += 32) {
  words.push(BigInt(`0x${publicInputs.subarray(i, i + 32).toString("hex")}`));
}

if (words.length !== NUM_ASSETS + 2) {
  throw new Error(`expected ${NUM_ASSETS + 2} public inputs, got ${words.length}`);
}

mkdirSync("./fixtures", { recursive: true });
copyFileSync(`${PROOF_DIR}/proof`, "./fixtures/multiasset-proof.bin");
writeFileSync(
  "./fixtures/multiasset-epoch.json",
  JSON.stringify(
    {
      prices: words.slice(0, NUM_ASSETS).map(String),
      rootHash: words[NUM_ASSETS].toString(),
      totalLiabilitiesUsd: words[NUM_ASSETS + 1].toString(),
    },
    null,
    2,
  ) + "\n",
);

console.log("Wrote fixtures/multiasset-proof.bin + fixtures/multiasset-epoch.json");
