import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { usernameToField } from "../prover/hash.ts";
import type { CustomerProof } from "../prover/kzg/grandSum.ts";
import { g1ToJson } from "../prover/kzg/json.ts";

export const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint256 totalReserves, uint64 timestamp)",
  "function currentCommitment() view returns (uint256 balanceX, uint256 balanceY, uint256 idX, uint256 idY, bytes32 rangeProofHash)",
  "function epochCount() view returns (uint256)",
  "function verifyInclusion(uint256 index, uint256 id, uint256 balance, uint256[2] proof) view returns (bool)",
]);

export type PublishedEpoch = {
  rootHash: bigint;
  totalLiabilities: bigint;
  totalReserves: bigint;
  timestamp: bigint;
  epochCount: bigint;
  rangeProofHash: `0x${string}`;
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
  const [epoch, commitment, epochCount] = await Promise.all([
    client.readContract({ address: registry, abi: registryAbi, functionName: "currentEpoch" }),
    client.readContract({ address: registry, abi: registryAbi, functionName: "currentCommitment" }),
    client.readContract({ address: registry, abi: registryAbi, functionName: "epochCount" }),
  ]);
  const [rootHash, totalLiabilities, totalReserves, timestamp] = epoch;
  return {
    rootHash,
    totalLiabilities,
    totalReserves,
    timestamp: BigInt(timestamp),
    epochCount,
    rangeProofHash: commitment[4],
  };
}

/**
 * The customer-side check.
 *
 * Unlike the Merkle-tree version, the cryptographic step happens *on-chain*:
 * `verifyInclusion` is a view function, so it costs nothing and needs no wallet,
 * and it necessarily runs against whatever commitment is published right now.
 * A proof from a superseded epoch therefore cannot pass — there is no separate
 * staleness check to forget.
 */
export async function checkInclusion(
  client: PublicClient,
  registry: `0x${string}`,
  proof: CustomerProof,
): Promise<InclusionResult> {
  const epoch = await readEpoch(client, registry);

  const [x, y] = g1ToJson(proof.proof);
  const included = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "verifyInclusion",
    args: [BigInt(proof.index), proof.id, proof.balance, [BigInt(x), BigInt(y)]],
  })) as boolean;

  const bound = usernameToField(proof.username) === proof.id;
  const solvent = epoch.totalReserves >= epoch.totalLiabilities;

  const checks = [
    {
      name: "the chain confirms this balance opens the published commitment",
      ok: included,
      detail: included
        ? `balance ${proof.balance} wei at index ${proof.index}, epoch #${epoch.epochCount - 1n}`
        : "the opening does not verify against the commitment published right now",
    },
    {
      name: "the proof is for this username",
      ok: bound,
      detail: bound ? `id ${proof.id} is keccak256("${proof.username}")` : "id does not match the username",
    },
    {
      name: "the published epoch is solvent",
      ok: solvent,
      detail: `${epoch.totalReserves} wei of reserves against ${epoch.totalLiabilities} wei of liabilities`,
    },
  ];

  return { ok: checks.every((check) => check.ok), epoch, checks };
}
