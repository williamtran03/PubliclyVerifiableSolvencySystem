import { createPublicClient, http, parseAbi } from "viem";

export const ASSET_NAMES = ["BTC", "ETH", "USDC"];

const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 liabilitiesUsd, uint256 assetsUsd, uint64 timestamp)",
  "function epochPrices(uint256) view returns (uint256)",
  "function epochRoundIds(uint256) view returns (uint80)",
]);

export type Epoch = {
  rootHash: bigint;
  liabilitiesUsd: bigint;
  assetsUsd: bigint;
  timestamp: bigint;
  prices: bigint[];
  roundIds: bigint[];
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
    /* private browsing */
  }
}

export async function readEpoch({ rpcUrl, registry }: Settings): Promise<Epoch> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error("Enter a valid registry address.");
  const client = createPublicClient({ transport: http(rpcUrl) });
  const address = registry as `0x${string}`;

  const read = (functionName: "epochPrices" | "epochRoundIds", i: number) =>
    client.readContract({ address, abi: registryAbi, functionName, args: [BigInt(i)] });

  const [current, ...table] = await Promise.all([
    client.readContract({ address, abi: registryAbi, functionName: "currentEpoch" }),
    ...ASSET_NAMES.map((_, i) => read("epochPrices", i)),
    ...ASSET_NAMES.map((_, i) => read("epochRoundIds", i)),
  ]);

  const [rootHash, liabilitiesUsd, assetsUsd, timestamp] = current;
  if (rootHash === 0n) throw new Error("This registry has not published an epoch yet.");

  return {
    rootHash,
    liabilitiesUsd,
    assetsUsd,
    timestamp: BigInt(timestamp),
    prices: table.slice(0, ASSET_NAMES.length) as bigint[],
    roundIds: table.slice(ASSET_NAMES.length) as bigint[],
  };
}

export const usd = (value: bigint) => `$${value.toLocaleString("en-US")}`;

export const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
