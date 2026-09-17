import { parseAbi } from "viem";
import { deserializeBundle, verifyBundle } from "@arms/zk-circuit/prover/multiAssetTree.ts";
import { assertEpoch, client, readFreshness, tokenMetadata } from "./common.ts";
import type { Solution } from "../types.ts";

const abi = parseAbi([
  "struct Epoch { uint256 rootHash; uint256 context; uint64[3] floors; uint256[3] reserveUnits; uint256[3] prices; uint80[3] roundIds; uint256 assetsUsd; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256) view returns (Epoch)",
  "function assets(uint256) view returns (address token, address feed, uint8 decimals, uint32 maxPriceAge)",
  "function BASE_DECIMALS() view returns (uint256)",
]);

export const zk: Solution = {
  id: "zk-circuit",
  name: "Zero-Knowledge Circuit",
  description: "Private liabilities with public reserve floors for each asset.",
  disclosure: "Individual balances and total liabilities remain private. The circuit supports three assets.",
  publication: ["Fetch the snapshot and reserve context: make zk-snapshot REGISTRY=0x…", "Build the witness and customer bundles: make zk-fixtures", "Generate and verify the proof: make zk-prove", "Publish with the company key: make zk-demo (local demo)"],
  async read(connection) {
    const c = client(connection);
    const blockNumber = await c.getBlockNumber({ cacheTime: 0 });
    const epoch = assertEpoch(await c.readContract({ address: connection.registry, abi, functionName: "epochCount", blockNumber }));
    const value = await c.readContract({ address: connection.registry, abi, functionName: "getEpoch", args: [epoch], blockNumber });
    const unitDecimals = Number(await c.readContract({ address: connection.registry, abi, functionName: "BASE_DECIMALS", blockNumber }));
    if (unitDecimals > 36) throw new Error("Unsupported proof unit scale.");
    const assets = await Promise.all(value.reserveUnits.map(async (reserves, i) => {
      const [token] = await c.readContract({ address: connection.registry, abi, functionName: "assets", args: [BigInt(i)], blockNumber });
      return { ...await tokenMetadata(c, token, blockNumber), unitDecimals, reserves, floor: value.floors[i] };
    }));
    return {
      epoch, timestamp: value.timestamp, commitment: `0x${value.rootHash.toString(16).padStart(64, "0")}`,
      assets,
      freshness: await readFreshness(c, connection.registry, blockNumber),
      data: { root: value.rootHash, context: value.context },
    };
  },
  async verify(_connection, snapshot, file, account, expected, secret) {
    if (!/^\d+$/.test(secret)) throw new Error("This proof requires your numeric account secret.");
    const bundle = deserializeBundle(file);
    const data = snapshot.data as { root: bigint; context: bigint };
    const valid = bundle.username === account && verifyBundle(bundle, { username: account, salt: BigInt(secret), expectedAmounts: expected }, data.root, data.context);
    return { valid, message: valid ? "Your entered balances are included in the published commitment." : "The bundle, balances, or secret do not match the current snapshot." };
  },
};
