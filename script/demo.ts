import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const RPC_URL = "http://127.0.0.1:8545";
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RESERVE_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const RESERVE_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

const registryAbi = parseAbi([
  "function submitEpoch(uint256 rootHash, uint256 totalLiabilities) external",
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint64 timestamp)",
]);

console.log("==> starting anvil");
try {
  execSync("lsof -ti:8545 | xargs kill -9", { stdio: "ignore" });
} catch {
  // nothing was listening, that's fine
}
const anvil = spawn("anvil", ["--silent"]);
process.on("exit", () => anvil.kill());
await new Promise((resolve) => setTimeout(resolve, 1000));

console.log("==> building tree from prover/customers.csv");
execSync("npx tsx prover/buildTree.ts", { stdio: "ignore" });

const { rootHash, totalLiabilities } = JSON.parse(readFileSync("fixtures/epoch.json", "utf8"));

const account = privateKeyToAccount(OWNER_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: foundry, transport: http(RPC_URL) });

console.log("==> deploying SolvencyRegistry (reserves: two funded Anvil accounts)");
const artifact = JSON.parse(readFileSync("out/SolvencyRegistry.sol/SolvencyRegistry.json", "utf8"));
const deployHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [[RESERVE_1, RESERVE_2]],
});
const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash: deployHash });
console.log(`    registry: ${contractAddress}`);

console.log("==> submitting epoch");
const submitHash = await walletClient.writeContract({
  address: contractAddress!,
  abi: registryAbi,
  functionName: "submitEpoch",
  args: [BigInt(rootHash), BigInt(totalLiabilities)],
});
await publicClient.waitForTransactionReceipt({ hash: submitHash });
console.log("OK: epoch accepted (reserves cover liabilities)");

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
    args: [BigInt(rootHash), BigInt(totalLiabilities)],
  });
  console.log("FAIL: insolvent epoch was accepted");
  process.exit(1);
} catch {
  console.log("OK: insolvent epoch correctly rejected");
}

console.log("==> demo complete");
process.exit(0);
