import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";

const ASSETS = ["BTC", "ETH", "USDC"];

const registry = process.argv[2];
const rpcUrl = process.argv[3] ?? "http://127.0.0.1:8545";

if (!/^0x[0-9a-fA-F]{40}$/.test(registry ?? "")) {
  console.error("Usage: npx tsx prover/fetchPrices.ts <registry address> [rpc url]");
  process.exit(1);
}

const abi = parseAbi(["function readPrices() view returns (uint256[3], uint80[3])"]);
const client = createPublicClient({ transport: http(rpcUrl) });

const [prices, roundIds] = await client.readContract({
  address: registry as `0x${string}`,
  abi,
  functionName: "readPrices",
});

// Read via the registry, not the feeds directly, so the prover cannot normalise
// or round differently than the contract will.
writeFileSync(
  "./prover/prices.json",
  JSON.stringify(
    {
      assets: ASSETS,
      pricesUsd: prices.map(String),
      roundIds: roundIds.map(String),
      registry,
      fetchedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(`Wrote prover/prices.json from ${registry}`);
for (const [i, asset] of ASSETS.entries()) {
  console.log(`  ${asset}: $${prices[i]} (round ${roundIds[i]})`);
}
