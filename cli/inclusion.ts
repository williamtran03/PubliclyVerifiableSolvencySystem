import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { poseidonHash } from "../prover/hash.ts";
import { verifyProof, type MerkleSumProof } from "../prover/merkleSumTree.ts";

export const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint256 totalReserves, uint64 timestamp)",
  "function epochCount() view returns (uint256)",
]);

export type PublishedEpoch = {
  rootHash: bigint;
  totalLiabilities: bigint;
  totalReserves: bigint;
  timestamp: bigint;
  epochCount: bigint;
};

export type InclusionResult = {
  ok: boolean;
  epoch: PublishedEpoch;
  checks: { name: string; ok: boolean; detail: string }[];
};

export function readOnlyClient(rpcUrl: string): PublicClient {
  // Read-only on purpose: checking your own balance must never ask a customer
  // for a wallet, a signature, or gas.
  return createPublicClient({ transport: http(rpcUrl) });
}

export async function readEpoch(
  client: PublicClient,
  registry: `0x${string}`,
): Promise<PublishedEpoch> {
  const [epoch, epochCount] = await Promise.all([
    client.readContract({ address: registry, abi: registryAbi, functionName: "currentEpoch" }),
    client.readContract({ address: registry, abi: registryAbi, functionName: "epochCount" }),
  ]);
  const [rootHash, totalLiabilities, totalReserves, timestamp] = epoch;
  return { rootHash, totalLiabilities, totalReserves, timestamp: BigInt(timestamp), epochCount };
}

/**
 * The customer-side check, in three parts that fail for genuinely different
 * reasons:
 *
 *  1. the proof is internally consistent — the path really does hash up to the
 *     root it claims;
 *  2. that root is the one published on-chain *right now*, not a superseded
 *     epoch (a valid proof against a stale root proves nothing about today);
 *  3. the epoch the custodian published was itself solvent.
 */
export async function checkInclusion(
  client: PublicClient,
  registry: `0x${string}`,
  proof: MerkleSumProof,
): Promise<InclusionResult> {
  const epoch = await readEpoch(client, registry);

  const cryptographic = verifyProof(proof, poseidonHash);
  const current =
    proof.rootHash === epoch.rootHash && proof.rootSum === epoch.totalLiabilities;
  const solvent = epoch.totalReserves >= epoch.totalLiabilities;

  const checks = [
    {
      name: "proof hashes up to its claimed root",
      ok: cryptographic,
      detail: cryptographic
        ? `balance ${proof.balance} wei is committed to under root ${proof.rootHash}`
        : "the sibling path does not reproduce the claimed root",
    },
    {
      name: "that root is the one published on-chain",
      ok: current,
      detail: current
        ? `epoch #${epoch.epochCount - 1n}, published at ${new Date(Number(epoch.timestamp) * 1000).toISOString()}`
        : `proof is for root ${proof.rootHash}; the chain currently says ${epoch.rootHash}`,
    },
    {
      name: "the published epoch is solvent",
      ok: solvent,
      detail: `${epoch.totalReserves} wei of reserves against ${epoch.totalLiabilities} wei of liabilities`,
    },
  ];

  return { ok: checks.every((check) => check.ok), epoch, checks };
}
