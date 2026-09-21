import { createPublicClient, http, parseAbi } from "viem";

export const ASSET_NAMES = ["BTC", "ETH", "USDC"];

const registryAbi = parseAbi([
  "struct Epoch { uint256 rootHash; uint256 context; uint64[3] floors; uint256[3] reserveUnits; uint256[3] prices; uint80[3] roundIds; uint256 assetsUsd; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function latestEpoch() view returns (Epoch)",
]);

export type Epoch = {
  epochId: bigint;
  rootHash: bigint;
  context: bigint;
  floors: bigint[];
  reserveUnits: bigint[];
  prices: bigint[];
  roundIds: bigint[];
  assetsUsd: bigint;
  timestamp: bigint;
};

export type Settings = { rpcUrl: string; registry: string };

const STORAGE_KEY = "northwind.settings";
const DEFAULTS: Settings = { rpcUrl: "http://127.0.0.1:8545", registry: "" };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}

export async function readEpoch({ rpcUrl, registry }: Settings): Promise<Epoch> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error("Enter a valid registry address.");
  const client = createPublicClient({ transport: http(rpcUrl) });
  const address = registry as `0x${string}`;

  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const count = await client.readContract({ address, abi: registryAbi, functionName: "epochCount", blockNumber });
  if (count === 0n) throw new Error("This registry has not published an epoch yet.");
  const epoch = await client.readContract({ address, abi: registryAbi, functionName: "latestEpoch", blockNumber });

  return {
    epochId: count - 1n,
    rootHash: epoch.rootHash,
    context: epoch.context,
    floors: [...epoch.floors],
    reserveUnits: [...epoch.reserveUnits],
    prices: [...epoch.prices],
    roundIds: [...epoch.roundIds],
    assetsUsd: epoch.assetsUsd,
    timestamp: epoch.timestamp,
  };
}

export const usd = (value: bigint) =>
  `$${(Number(value) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

export const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
