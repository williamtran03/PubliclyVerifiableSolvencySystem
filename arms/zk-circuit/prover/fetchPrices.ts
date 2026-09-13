import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";

const ASSETS = ["BTC", "ETH", "USDC"];
const abi = parseAbi(["function readPrices() view returns (uint256[3], uint80[3])"]);

// Read via the registry, not the feeds directly, so the prover cannot normalise
// or round differently than the contract will.
export async function fetchPriceTable(rpcUrl: string, registry: `0x${string}`) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const [pricesUsd, roundIds] = await client.readContract({ address: registry, abi, functionName: "readPrices" });
  return { pricesUsd, roundIds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const registry = process.argv[2];
  const rpcUrl = process.argv[3] ?? "http://127.0.0.1:8545";

  if (!/^0x[0-9a-fA-F]{40}$/.test(registry ?? "")) {
    console.error("Usage: npx tsx arms/zk-circuit/prover/fetchPrices.ts <registry address> [rpc url]");
    process.exit(1);
  }

  const { pricesUsd, roundIds } = await fetchPriceTable(rpcUrl, registry as `0x${string}`);

  writeFileSync(
    "./arms/zk-circuit/prover/prices.json",
    JSON.stringify(
      {
        assets: ASSETS,
        pricesUsd: pricesUsd.map(String),
        roundIds: roundIds.map(String),
        registry,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Wrote arms/zk-circuit/prover/prices.json from ${registry}`);
  for (const [i, asset] of ASSETS.entries()) {
    console.log(`  ${asset}: $${pricesUsd[i]} (round ${roundIds[i]})`);
  }
}
