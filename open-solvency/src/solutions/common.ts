import { createPublicClient, http, parseAbi, zeroAddress, type Address } from "viem";
import type { Connection } from "../types.ts";

export function client(connection: Connection) {
  return createPublicClient({ transport: http(connection.rpc, { timeout: 10000 }) });
}

export function assertEpoch(count: bigint): bigint {
  if (count === 0n) throw new Error("This registry has not published a snapshot yet.");
  return count - 1n;
}

const freshnessAbi = parseAbi([
  "function isCurrent() view returns (bool)",
  "function epochAge() view returns (uint64)",
  "function maxEpochAge() view returns (uint64)",
  "function lapses() view returns (uint64)",
]);
export async function readFreshness(c: ReturnType<typeof client>, address: Address, blockNumber: bigint) {
  const [current, age, maxAge, lapses] = await Promise.all([
    c.readContract({ address, abi: freshnessAbi, functionName: "isCurrent", blockNumber }),
    c.readContract({ address, abi: freshnessAbi, functionName: "epochAge", blockNumber }),
    c.readContract({ address, abi: freshnessAbi, functionName: "maxEpochAge", blockNumber }),
    c.readContract({ address, abi: freshnessAbi, functionName: "lapses", blockNumber }),
  ]);
  return { current, age, maxAge, lapses };
}

const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
export async function tokenMetadata(c: ReturnType<typeof client>, token: Address, blockNumber: bigint) {
  if (token === zeroAddress) return { label: "ETH", token, unitDecimals: 18 };
  const [symbol, decimals] = await Promise.allSettled([
    c.readContract({ address: token, abi: tokenAbi, functionName: "symbol", blockNumber }),
    c.readContract({ address: token, abi: tokenAbi, functionName: "decimals", blockNumber }),
  ]);
  return {
    label: symbol.status === "fulfilled" && symbol.value.length > 0 && symbol.value.length <= 32 ? symbol.value : `${token.slice(0, 8)}…${token.slice(-4)}`,
    token,
    unitDecimals: decimals.status === "fulfilled" && decimals.value <= 36 ? decimals.value : undefined,
  };
}
