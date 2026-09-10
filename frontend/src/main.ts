import { createPublicClient, http, parseAbi } from "viem";
import { verifyProof, deserializeProof, poseidon2Hash } from "@prover/merkleSumTree.ts";
import { deserializeSplitBundle, verifySplitBundle } from "../../prover/split/splitProof.ts";

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
  document.querySelector<HTMLDivElement>("#splitResult")!.textContent = "";
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

document.querySelector<HTMLButtonElement>("#splitVerifyBtn")!.addEventListener("click", async () => {
  const result = document.querySelector<HTMLDivElement>("#splitResult")!;
  result.textContent = "Checking locally...";
  const root = onChainRootHash, total = onChainEpochValue;
  try {
    if (root === null || total === null) throw new Error("Read the current epoch first.");
    const file = document.querySelector<HTMLInputElement>("#splitFile")!.files?.[0];
    if (!file || file.size > 262144) throw new Error("Select a bundle of at most 256 KB.");
    const customer = document.querySelector<HTMLInputElement>("#splitCustomer")!.value.trim();
    const expected = document.querySelector<HTMLInputElement>("#splitBalance")!.value.trim();
    if (!/^(0|[1-9][0-9]*)$/.test(expected) || expected.length > 80) throw new Error("Enter an unsigned balance in wei.");
    const bundle = deserializeSplitBundle(await file.text());
    if (root !== onChainRootHash || total !== onChainEpochValue) throw new Error("Snapshot changed; verify again.");
    if (!verifySplitBundle(bundle, customer, BigInt(expected), root, total)) throw new Error("Bundle does not match your full balance and the selected commitment.");
    result.textContent = "VALID: all supplied parts match your expected full balance and the published root and total. This does not prove disclosure of other customers or debts.";
  } catch (error) { result.textContent = `INVALID: ${error instanceof Error ? error.message : String(error)}`; }
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
