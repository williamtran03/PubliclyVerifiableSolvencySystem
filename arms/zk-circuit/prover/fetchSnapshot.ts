import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";

const ASSETS = ["BTC", "ETH", "USDC"];
const abi = parseAbi([
  "function readPrices() view returns (uint256[3], uint80[3])",
  "function reserveUnits() view returns (uint256[3])",
  "function epochCount() view returns (uint256)",
  "function epochContext(uint256) view returns (uint256)",
]);

export type Snapshot = {
  registry: `0x${string}`;
  chainId: bigint;
  epochId: bigint;
  context: bigint;
  reserveUnits: readonly bigint[];
  pricesUsd: readonly bigint[];
  roundIds: readonly bigint[];
};

export async function fetchSnapshot(rpcUrl: string, registry: `0x${string}`): Promise<Snapshot> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const read = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: registry, abi, functionName, args } as any) as Promise<T>;

  const [chainId, epochId, reserveUnits, [pricesUsd, roundIds]] = await Promise.all([
    client.getChainId().then(BigInt),
    read<bigint>("epochCount"),
    read<readonly bigint[]>("reserveUnits"),
    read<readonly [readonly bigint[], readonly bigint[]]>("readPrices"),
  ]);
  const context = await read<bigint>("epochContext", [epochId]);
  return { registry, chainId, epochId, context, reserveUnits, pricesUsd, roundIds };
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return (
    JSON.stringify(
      { assets: ASSETS, ...snapshot, fetchedAt: new Date().toISOString() },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const registry = process.argv[2];
  const rpcUrl = process.argv[3] ?? "http://127.0.0.1:8545";

  if (!/^0x[0-9a-fA-F]{40}$/.test(registry ?? "")) {
    console.error("Usage: npx tsx arms/zk-circuit/prover/fetchSnapshot.ts <registry address> [rpc url]");
    process.exit(1);
  }

  const snapshot = await fetchSnapshot(rpcUrl, registry as `0x${string}`);
  writeFileSync("./arms/zk-circuit/prover/snapshot.json", serializeSnapshot(snapshot));

  console.log(`Wrote arms/zk-circuit/prover/snapshot.json for epoch ${snapshot.epochId} of ${registry}`);
  for (const [i, asset] of ASSETS.entries()) {
    const price = Number(snapshot.pricesUsd[i]) / 1e8;
    console.log(`  ${asset}: reserves ${snapshot.reserveUnits[i]}, $${price} (round ${snapshot.roundIds[i]})`);
  }
}
