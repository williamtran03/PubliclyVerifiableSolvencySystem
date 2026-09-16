import { createPublicClient, http } from "viem";
import type { Connection } from "../types.ts";

export function client(connection: Connection) {
  return createPublicClient({ transport: http(connection.rpc, { timeout: 10000 }) });
}

export function assertEpoch(count: bigint): bigint {
  if (count === 0n) throw new Error("This registry has not published a snapshot yet.");
  return count - 1n;
}
