import { parseAbi } from "viem";
import { deserializeBundle, verifyBundle } from "@arms/zk-circuit/prover/multiAssetTree.ts";
import { assertEpoch, client } from "./common.ts";
import type { Solution } from "../types.ts";

const abi = parseAbi([
  "struct Epoch { uint256 rootHash; uint256 context; uint64[3] floors; uint256[3] reserveUnits; uint256[3] prices; uint80[3] roundIds; uint256 assetsUsd; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function latestEpoch() view returns (Epoch)",
]);

export const zk: Solution = {
  id: "zk-circuit",
  name: "Zero-Knowledge-Circuit",
  description: "Private Verbindlichkeiten, öffentliche Reserve-Untergrenzen je Asset.",
  disclosure: "Die individuellen Beträge und Gesamtschulden bleiben privat. Der Circuit ist auf drei Assets ausgelegt.",
  publication: ["Snapshot und Reserve-Kontext aus dem Register holen: make zk-snapshot REGISTRY=0x…", "Witness und Kunden-Bundles erzeugen: make zk-fixtures", "Proof erzeugen und prüfen: make zk-prove", "Proof mit dem Company-Key veröffentlichen: make zk-demo (lokale Demo)"],
  async read(connection) {
    const c = client(connection);
    const epoch = assertEpoch(await c.readContract({ address: connection.registry, abi, functionName: "epochCount" }));
    const value = await c.readContract({ address: connection.registry, abi, functionName: "latestEpoch" });
    return {
      epoch, timestamp: value.timestamp, commitment: `0x${value.rootHash.toString(16).padStart(64, "0")}`,
      assets: value.reserveUnits.map((reserves, i) => ({ label: `Asset ${i}`, reserves, floor: value.floors[i] })),
      data: { root: value.rootHash, context: value.context },
    };
  },
  async verify(_connection, snapshot, file, account, expected, secret) {
    if (!/^\d+$/.test(secret)) throw new Error("Für diesen Nachweis wird dein numerisches Account-Secret benötigt.");
    const bundle = deserializeBundle(file);
    const data = snapshot.data as { root: bigint; context: bigint };
    const valid = bundle.username === account && verifyBundle(bundle, { username: account, salt: BigInt(secret), expectedAmounts: expected }, data.root, data.context);
    return { valid, message: valid ? "Deine eingegebenen Guthaben sind im veröffentlichten Commitment enthalten." : "Bundle, Guthaben oder Secret passen nicht zum aktuellen Snapshot." };
  },
};
