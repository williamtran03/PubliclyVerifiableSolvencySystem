import { createPublicClient, http, parseAbi } from "viem";
import { verifyProof, deserializeProof, poseidon2Hash } from "@shared/merkleSumTree.ts";

const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalReservesAtEpoch, uint64 timestamp)",
]);

let onChainRootHash: bigint | null = null;
// Second field of currentEpoch(): reserves on SolvencyRegistry (the ZK arm no
// longer publishes liabilities), published total on MerkleSumRegistry.
let onChainEpochValue: bigint | null = null;

const rpcUrlInput = document.querySelector<HTMLInputElement>("#rpcUrl")!;
const registryAddressInput = document.querySelector<HTMLInputElement>("#registryAddress")!;
const connectBtn = document.querySelector<HTMLButtonElement>("#connectBtn")!;
const epochResult = document.querySelector<HTMLDivElement>("#epochResult")!;
const customerSelect = document.querySelector<HTMLSelectElement>("#customerSelect")!;
const verifyBtn = document.querySelector<HTMLButtonElement>("#verifyBtn")!;
const verifyResult = document.querySelector<HTMLDivElement>("#verifyResult")!;

connectBtn.addEventListener("click", async () => {
  onChainRootHash = null;
  onChainEpochValue = null;
  epochResult.textContent = "reading currentEpoch()...";
  try {
    const client = createPublicClient({ transport: http(rpcUrlInput.value) });
    const [rootHash, reserves, timestamp] = await client.readContract({
      address: registryAddressInput.value as `0x${string}`,
      abi: registryAbi,
      functionName: "currentEpoch",
    });

    onChainRootHash = rootHash;
    onChainEpochValue = reserves;

    epochResult.textContent =
      `rootHash: 0x${rootHash.toString(16)}\n` +
      `reserves at epoch: ${reserves}\n` +
      `timestamp: ${new Date(Number(timestamp) * 1000).toLocaleString()}`;

    const usernames: string[] = await fetch("/proofs/index.json").then((r) => r.json());
    customerSelect.innerHTML = usernames.map((u) => `<option value="${u}">${u}</option>`).join("");
    customerSelect.disabled = false;
    verifyBtn.disabled = false;
  } catch (err) {
    epochResult.textContent = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
});

verifyBtn.addEventListener("click", async () => {
  if (onChainRootHash === null || onChainEpochValue === null) return;

  const username = customerSelect.value;
  verifyResult.textContent = "fetching proof + verifying locally...";

  const proofJson = await fetch(`/proofs/${username}.json`).then((r) => r.text());
  const proof = deserializeProof(proofJson);

  if (proof.rootHash !== onChainRootHash) {
    verifyResult.innerHTML = `<span class="fail">MISMATCH</span>: proof is for a different epoch than what's on-chain.`;
    return;
  }

  const valid = verifyProof(proof, poseidon2Hash);
  verifyResult.innerHTML = valid
    ? `<span class="ok">VALID</span> — ${proof.entry.username}'s balance (${proof.entry.balance}) is included in the published root.`
    : `<span class="fail">INVALID</span> — cryptographic check failed.`;
});
