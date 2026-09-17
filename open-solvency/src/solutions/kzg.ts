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
  name: "KZG without a circuit",
  description: "Polynomial commitments with on-chain verification of customer inclusion.",
  disclosure: "Currently supports one asset and eight account slots. Total liabilities are public.",
  publication: ["Prepare the SRS once: make kzg-setup. It is not rebuilt per epoch, so keep srs.json; regenerating it invalidates every earlier proof.", "Deploy the registry first, then record its address, chain ID and next epoch ID in a snapshot.json. The proof transcript binds to that address.", "Build the epoch: make kzg-epoch SNAPSHOT=<snapshot.json> OUT=<directory>. This writes four files: epoch.json, range-proof.json, inclusion.json and attack.json. Omitting both variables overwrites the committed fixtures.", "Review the artifacts before signing.", "Call submitEpoch with the company key and deliver each customer opening from inclusion.json privately.", "For a local end-to-end run of all of the above: make kzg-demo"],
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
    if (!/^\d+$/.test(secret)) throw new Error("This proof requires your numeric account secret.");
    if (expected.size !== 1 || !expected.has(0)) throw new Error("KZG requires exactly asset 0.");
    const bundle = JSON.parse(file) as KzgBundle;
    if (bundle.username !== account || !Number.isSafeInteger(bundle.index) || bundle.index < 0 || bundle.index >= 8) return { valid: false, message: "The account or proof index does not match." };
    const identity = poseidon2Hash([usernameToBigInt(account), BigInt(secret)]);
    const balance = expected.get(0)!;
    if (BigInt(bundle.identity) !== identity || BigInt(bundle.balance) !== balance) return { valid: false, message: "The balance or secret does not match the customer proof." };
    const valid = await client(connection).readContract({
      address: connection.registry, abi, functionName: "verifyInclusion",
      args: [snapshot.epoch, BigInt(bundle.index), identity, balance, { x: BigInt(bundle.proof.x), y: BigInt(bundle.proof.y) }],
    });
    return { valid, message: valid ? "The contract confirms your inclusion in this snapshot." : "The contract rejected the customer proof." };
  },
};
