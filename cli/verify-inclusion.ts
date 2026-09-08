import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { foundry } from "viem/chains";
import { verifyProof, deserializeProof, poseidon2Hash } from "../prover/merkleSumTree.ts";

const registryAddress = process.argv[2];
const proofPath = process.argv[3] ?? "./fixtures/proof-customer-123.json";

if (!registryAddress) {
  console.error("Usage: npx tsx cli/verify-inclusion.ts <registry address> [proof file]");
  process.exit(1);
}

const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint64 timestamp)",
]);

const client = createPublicClient({ chain: foundry, transport: http() });

const [onChainRootHash, onChainTotalLiabilities] = await client.readContract({
  address: registryAddress as `0x${string}`,
  abi: registryAbi,
  functionName: "currentEpoch",
});

const proof = deserializeProof(readFileSync(proofPath, "utf8"));

console.log(
  `Checking ${proof.entry.username}'s balance (${proof.entry.balance}) against the on-chain root...`,
);

if (proof.rootHash !== onChainRootHash || proof.rootSum !== onChainTotalLiabilities) {
  console.log(
    "MISMATCH: this proof is for a different epoch than what's currently published on-chain.",
  );
  process.exit(1);
}

const valid = verifyProof(proof, poseidon2Hash);
console.log(
  valid
    ? "VALID: your balance is included in the published root."
    : "INVALID: cryptographic check failed.",
);
