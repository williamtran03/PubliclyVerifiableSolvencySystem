/**
 * Public check that nobody's balance is secretly negative.
 *
 * The registry stores only the hash of the range argument, so this does two
 * things: confirms the file on disk is the artifact the chain committed to, and
 * then actually verifies it. Anyone can run this — it needs no wallet, no gas,
 * and no permission from the custodian.
 *
 * Usage: npx tsx cli/verify-range.ts <registry address> [rpc url]
 */
import { readFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { verifyRange } from "../prover/kzg/range.ts";
import { g1FromJson, rangeProofFromJson } from "../prover/kzg/json.ts";
import { loadSrs } from "../prover/kzg/srs.ts";
import { readEpoch, readOnlyClient } from "./inclusion.ts";

const [registry, rpcUrl = "http://127.0.0.1:8545"] = process.argv.slice(2);
if (!registry) {
  console.error("Usage: npx tsx cli/verify-range.ts <registry address> [rpc url]");
  process.exit(2);
}

const epochJson = JSON.parse(readFileSync("fixtures/kzg-epoch.json", "utf8"));
const rangeProofFile = readFileSync("fixtures/range-proof.json", "utf8");

const published = await readEpoch(readOnlyClient(rpcUrl), registry as `0x${string}`);
const localHash = keccak256(toBytes(rangeProofFile));
const pinned = localHash === published.rangeProofHash;

const srs = loadSrs("fixtures/srs.json");
const verified =
  pinned &&
  verifyRange(
    srs,
    g1FromJson(epochJson.balanceCommitment),
    Number(epochJson.domainSize),
    rangeProofFromJson(rangeProofFile),
  );

console.log(`  [${pinned ? "ok" : "FAIL"}] the file is the artifact the chain committed to`);
console.log(`         on-chain ${published.rangeProofHash}\n         local    ${localHash}`);
console.log(`  [${verified ? "ok" : "FAIL"}] every balance is a 128-bit non-negative number`);

console.log(verified ? "\nVALID" : "\nINVALID");
process.exit(verified ? 0 : 1);
