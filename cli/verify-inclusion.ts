/**
 * Customer-facing check: "is my balance really inside the published total?"
 *
 * Usage: npx tsx cli/verify-inclusion.ts <registry address> [proof file] [rpc url]
 */
import { readFileSync } from "node:fs";
import { deserializeProof } from "../prover/merkleSumTree.ts";
import { checkInclusion, readOnlyClient } from "./inclusion.ts";

const [registry, proofPath = "./fixtures/proof-customer-123.json", rpcUrl = "http://127.0.0.1:8545"] =
  process.argv.slice(2);

if (!registry) {
  console.error("Usage: npx tsx cli/verify-inclusion.ts <registry address> [proof file] [rpc url]");
  process.exit(2);
}

const proof = deserializeProof(readFileSync(proofPath, "utf8"));
const result = await checkInclusion(readOnlyClient(rpcUrl), registry as `0x${string}`, proof);

console.log(`customer: ${proof.username}`);
console.log(`balance:  ${proof.balance} wei`);
for (const check of result.checks) {
  console.log(`  [${check.ok ? "ok" : "FAIL"}] ${check.name}\n         ${check.detail}`);
}
console.log(result.ok ? "\nVALID" : "\nINVALID");

process.exit(result.ok ? 0 : 1);
