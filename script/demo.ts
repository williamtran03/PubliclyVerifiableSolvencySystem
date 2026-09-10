import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const RPC_URL = "http://127.0.0.1:8545";
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RESERVE_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const RESERVE_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

const registryAbi = parseAbi([
  "function submitEpoch(bytes proof, uint256 rootHash) external",
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalReservesAtEpoch, uint64 timestamp)",
  "function totalReserves() view returns (uint256)",
]);

// The proof commits to this figure as a public input, so the reserves have to
// add up to exactly it. Anvil accounts start with far more than that.
const PROVEN_ASSETS = BigInt(process.env.ASSETS ?? "50000");

console.log("==> starting anvil");
try {
  execSync("lsof -ti:8545 | xargs kill -9", { stdio: "ignore" });
} catch {}
const anvil = spawn("anvil", ["--silent"]);
process.on("exit", () => anvil.kill());
await new Promise((resolve) => setTimeout(resolve, 1000));

console.log("==> building tree + proving circuit (prover/customers.csv -> fixtures/*)");
execSync("make circuit-prove", { stdio: "inherit" });

const { rootHash } = JSON.parse(readFileSync("fixtures/single-asset/epoch.json", "utf8"));
const proof = toHex(readFileSync("fixtures/single-asset/proof.bin"));

const account = privateKeyToAccount(OWNER_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: foundry, transport: http(RPC_URL) });

async function deployLibrary(name: string): Promise<`0x${string}`> {
  const artifact = JSON.parse(readFileSync(`out/HonkVerifier.sol/${name}.json`, "utf8"));
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
  });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  return contractAddress!;
}

function linkLibraries(
  bytecode: `0x${string}`,
  linkReferences: Record<string, Record<string, { start: number; length: number }[]>>,
  addresses: Record<string, string>,
): `0x${string}` {
  let hex = bytecode.slice(2);
  for (const refs of Object.values(linkReferences)) {
    for (const [libName, positions] of Object.entries(refs)) {
      const addressHex = addresses[libName].slice(2).toLowerCase();
      for (const { start, length } of positions) {
        hex = hex.slice(0, start * 2) + addressHex.padStart(length * 2, "0") + hex.slice(start * 2 + length * 2);
      }
    }
  }
  return `0x${hex}`;
}

console.log("==> deploying RelationsLib + ZKTranscriptLib (linked into HonkVerifier)");
const relationsLib = await deployLibrary("RelationsLib");
const zkTranscriptLib = await deployLibrary("ZKTranscriptLib");

console.log("==> deploying HonkVerifier");
const verifierArtifact = JSON.parse(readFileSync("out/HonkVerifier.sol/HonkVerifier.json", "utf8"));
const linkedBytecode = linkLibraries(verifierArtifact.bytecode.object, verifierArtifact.bytecode.linkReferences, {
  RelationsLib: relationsLib,
  ZKTranscriptLib: zkTranscriptLib,
});
const verifierDeployHash = await walletClient.deployContract({
  abi: verifierArtifact.abi,
  bytecode: linkedBytecode,
  args: [],
});
const { contractAddress: verifierAddress } = await publicClient.waitForTransactionReceipt({
  hash: verifierDeployHash,
});
console.log(`    verifier: ${verifierAddress}`);

console.log("==> deploying SolvencyRegistry (reserves: two funded Anvil accounts)");
const artifact = JSON.parse(readFileSync("out/SolvencyRegistry.sol/SolvencyRegistry.json", "utf8"));
const deployHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [[RESERVE_1, RESERVE_2], verifierAddress],
});
const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash: deployHash });
console.log(`    registry: ${contractAddress}`);

console.log(`==> setting reserves to the proven assets figure (${PROVEN_ASSETS})`);
for (const wallet of [RESERVE_1, RESERVE_2]) {
  await publicClient.request({
    method: "anvil_setBalance" as any,
    params: [wallet, `0x${(PROVEN_ASSETS / 2n).toString(16)}`] as any,
  });
}

console.log("==> submitting epoch (with ZK proof)");
const submitHash = await walletClient.writeContract({
  address: contractAddress!,
  abi: registryAbi,
  functionName: "submitEpoch",
  args: [proof, BigInt(rootHash)],
});
await publicClient.waitForTransactionReceipt({ hash: submitHash });
console.log("OK: epoch accepted (circuit proved liabilities <= reserves, total never published)");

console.log("==> customer inclusion check");
execSync(`npx tsx cli/verify-inclusion.ts ${contractAddress}`, { stdio: "inherit" });

console.log("==> draining both reserves");
await publicClient.request({
  method: "anvil_setBalance" as any,
  params: [RESERVE_1, "0x0"] as any,
});
await publicClient.request({
  method: "anvil_setBalance" as any,
  params: [RESERVE_2, "0x0"] as any,
});

console.log("==> submitting again, expecting rejection");
try {
  await walletClient.writeContract({
    address: contractAddress!,
    abi: registryAbi,
    functionName: "submitEpoch",
    args: [proof, BigInt(rootHash)],
  });
  console.log("FAIL: insolvent epoch was accepted");
  process.exit(1);
} catch {
  console.log("OK: insolvent epoch correctly rejected");
}

console.log("==> demo complete");
process.exit(0);
