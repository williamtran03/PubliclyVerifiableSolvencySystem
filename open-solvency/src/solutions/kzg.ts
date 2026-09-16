import { parseAbi } from "viem";
import { poseidon2Hash, usernameToBigInt } from "@shared/merkleSumTree.ts";
import { assertEpoch, client } from "./common.ts";
import type { Solution } from "../types.ts";

const abi = parseAbi([
  "struct G1Point { uint256 x; uint256 y; }",
  "struct Epoch { G1Point balanceCommitment; G1Point identityCommitment; uint256 totalLiabilities; uint256 reserveUnits; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256) view returns (Epoch)",
  "function verifyInclusion(uint256 epochId, uint256 index, uint256 identity, uint256 balance, G1Point proof) view returns (bool)",
]);

type KzgBundle = { username: string; index: number; identity: string; balance: string; proof: { x: string; y: string } };

export const kzg: Solution = {
  id: "snarkless",
  name: "KZG ohne Circuit",
  description: "Polynomial-Commitments und On-Chain-Prüfung der Kundeneinbeziehung.",
  disclosure: "Aktuell ein Asset und acht Kontoplätze. Die Gesamtverbindlichkeit ist öffentlich.",
  publication: ["Einmalig SRS vorbereiten: make kzg-setup", "Epoch-Daten, Range-Proof und Kundenöffnungen erzeugen: make kzg-epoch", "Artefakte vor dem Signieren prüfen.", "submitEpoch mit dem Company-Key ausführen und Kundenöffnungen einzeln zustellen."],
  async read(connection) {
    const c = client(connection);
    const epoch = assertEpoch(await c.readContract({ address: connection.registry, abi, functionName: "epochCount" }));
    const value = await c.readContract({ address: connection.registry, abi, functionName: "getEpoch", args: [epoch] });
    return {
      epoch, timestamp: value.timestamp,
      commitment: `(${value.balanceCommitment.x}, ${value.balanceCommitment.y})`,
      assets: [{ label: "Asset 0", reserves: value.reserveUnits, liabilities: value.totalLiabilities }],
      data: value,
    };
  },
  async verify(connection, snapshot, file, account, expected, secret) {
    if (!/^\d+$/.test(secret)) throw new Error("Für diesen Nachweis wird dein numerisches Account-Secret benötigt.");
    if (expected.size !== 1 || !expected.has(0)) throw new Error("KZG erwartet genau Asset 0.");
    const bundle = JSON.parse(file) as KzgBundle;
    if (bundle.username !== account || !Number.isSafeInteger(bundle.index) || bundle.index < 0 || bundle.index >= 8) return { valid: false, message: "Konto oder Proof-Index passt nicht." };
    const identity = poseidon2Hash([usernameToBigInt(account), BigInt(secret)]);
    const balance = expected.get(0)!;
    if (BigInt(bundle.identity) !== identity || BigInt(bundle.balance) !== balance) return { valid: false, message: "Guthaben oder Secret passt nicht zum Kunden-Proof." };
    const valid = await client(connection).readContract({
      address: connection.registry, abi, functionName: "verifyInclusion",
      args: [snapshot.epoch, BigInt(bundle.index), identity, balance, { x: BigInt(bundle.proof.x), y: BigInt(bundle.proof.y) }],
    });
    return { valid, message: valid ? "Der Contract bestätigt deine Einbeziehung in diesen Snapshot." : "Der Contract lehnt den Kunden-Proof ab." };
  },
};
