import { readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { parseEther, toHex, type Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { prepareEpoch, readSnapshot } from "../prover/buildMultiAssetTree.ts";
import { createBundle, parseHoldingsCsv } from "../prover/multiAssetTree.ts";
import { encodePacked, keccak256 } from "viem";
import { auditor, company, demoChain, isMain, maxEpochAge, outputDirectory, writeJson } from "../../../scripts/demo/chain.ts";

export async function runZkDemo(rpc: string, output: string) {
  const { client, wallet, artifact, deploy, send, approveReserve, chain } = await demoChain(rpc);
  if (chain.id !== 31337 || await client.getTransactionCount({ address: company.address }) !== 0) throw new Error("The committed ZK proof requires a fresh Anvil node with chain ID 31337. Use npm run demo to manage a separate node for each arm.");
  const btc = await deploy("DemoAsset.sol", "DemoAsset", ["BTC", 8]);
  const usdc = await deploy("DemoAsset.sol", "DemoAsset", ["USDC", 6]);
  const feeds = [];
  for (const price of [60000n, 3000n, 1n]) feeds.push(await deploy("DemoMocks.sol", "MockAggregator", [8, price * 10n ** 8n]));
  const libraries = {
    RelationsLib: await deploy("MultiAssetHonkVerifier.sol", "RelationsLib"),
    ZKTranscriptLib: await deploy("MultiAssetHonkVerifier.sol", "ZKTranscriptLib"),
  };
  const verifier = await deploy("MultiAssetHonkVerifier.sol", "HonkVerifier", [], libraries);
  const registry = await deploy("MultiAssetSolvencyRegistry.sol", "MultiAssetSolvencyRegistry", [company.address, auditor.address, [
    { token: btc, feed: feeds[0], decimals: 8, maxPriceAge: 3600 },
    { token: "0x0000000000000000000000000000000000000000", feed: feeds[1], decimals: 18, maxPriceAge: 3600 },
    { token: usdc, feed: feeds[2], decimals: 6, maxPriceAge: 86400 },
  ], verifier, maxEpochAge]);
  const snapshot = readSnapshot("arms/zk-circuit/prover/snapshot.json");
  assert.equal(registry.toLowerCase(), snapshot.registry.toLowerCase(), "ZK fixture address mismatch");
  const abi = artifact("MultiAssetSolvencyRegistry.sol", "MultiAssetSolvencyRegistry").abi as Abi;
  const reserve = privateKeyToAccount(generatePrivateKey());
  const tokenAbi = artifact("DemoAsset.sol", "DemoAsset").abi;
  await send(company, btc, tokenAbi, "mint", [reserve.address, 3n * 10n ** 8n]);
  await send(company, usdc, tokenAbi, "mint", [reserve.address, 6000n * 10n ** 6n]);
  await client.waitForTransactionReceipt({ hash: await wallet(company).sendTransaction({ to: reserve.address, value: parseEther("12") }) });
  await approveReserve(registry, abi, reserve);
  const epoch = JSON.parse(readFileSync("arms/zk-circuit/fixtures/epoch.json", "utf8"));
  const proof = toHex(readFileSync("arms/zk-circuit/fixtures/proof.bin"));
  const holdings = parseHoldingsCsv(readFileSync("arms/zk-circuit/prover/customers.csv", "utf8"));
  const prepared = prepareEpoch(holdings, snapshot, keccak256(encodePacked(["string"], ["northwind demo tree seed"])));
  assert.equal(prepared.rootHash, BigInt(epoch.rootHash), "Committed proof and customer data do not match");
  await send(company, registry, abi, "submitEpoch", [proof, BigInt(epoch.rootHash), epoch.floors.map(BigInt), snapshot.roundIds]);
  for (const username of new Set(holdings.map(h => h.username))) writeJson(output, `zk-${username}.json`, createBundle(username, prepared.padded, prepared.levels));
  writeJson(output, "zk-epoch.json", epoch);
  copyFileSync("arms/zk-circuit/fixtures/proof.bin", join(output, "zk-proof.bin"));
  const connection = { rpc, registry, chainId: chain.id };
  writeJson(output, "zk-connection.json", connection);
  console.log(`ZK circuit: ${rpc} · ${registry}\nArtifacts: ${output}`);
  return connection;
}

if (isMain(import.meta.url)) await runZkDemo(process.env.RPC_URL ?? "http://127.0.0.1:8546", outputDirectory());
