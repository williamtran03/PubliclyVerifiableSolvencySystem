import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Abi } from "viem";
import { loadSrs, type G1Point } from "../prover/srs.ts";
import { buildGrandSumEpoch, epochContext, identityOf, proveInclusion, type Account } from "../prover/grandSum.ts";
import { proveLiabilities } from "../prover/liabilities.ts";
import { auditor, company, demoChain, isMain, maxEpochAge, minEpochInterval, outputDirectory, writeJson } from "../../../scripts/demo/chain.ts";

const point = (p: G1Point) => p.toAffine();

export async function runKzgDemo(rpc: string, output: string) {
  const { client, artifact, deploy, deployDirectory, send, proveReserve, approveReserve, sampleReserves, chain } = await demoChain(rpc);
  const srs = loadSrs("arms/snarkless/fixtures/srs.json");
  const token = await deploy("DemoAsset.sol", "DemoAsset", ["TEST", 0]);
  const abi = artifact("KzgSolvencyRegistry.sol", "KzgSolvencyRegistry").abi as Abi;
  const registry = await deploy("KzgSolvencyRegistry.sol", "KzgSolvencyRegistry", [company.address, auditor.address, token, 0, maxEpochAge, minEpochInterval, await deployDirectory()]);
  const reserve = privateKeyToAccount(generatePrivateKey());
  await send(company, token, artifact("DemoAsset.sol", "DemoAsset").abi, "mint", [reserve.address, 50000n]);
  await approveReserve(registry, abi, reserve);
  await sampleReserves(registry, abi);
  const accounts: Account[] = readFileSync("shared/customers.csv", "utf8").trim().split("\n").slice(1).map(row => {
    const [username, balance, , secretCommitment] = row.split(",");
    return { username, balance: BigInt(balance), secretCommitment: BigInt(secretCommitment) };
  });
  const epoch = buildGrandSumEpoch(srs, accounts);
  const sum = { balanceCommitment: point(epoch.balanceCommitment), identityCommitment: point(epoch.identityCommitment), totalLiabilities: epoch.totalLiabilities };
  const proofArtifactOf = (proof: ReturnType<typeof proveLiabilities>) => ({ bitCommitments: proof.bitCommitments.map(point), accumulatorCommitment: point(proof.accumulatorCommitment), quotientCommitment: point(proof.quotientCommitment), values: proof.values, shiftedAccumulator: proof.shiftedAccumulator, proofAtZeta: point(proof.proofAtZeta), proofAtShiftedZeta: point(proof.proofAtShiftedZeta) });
  let submitted: ReturnType<typeof proofArtifactOf> | undefined;
  for (const epochId of [0n, 1n]) {
    const context = epochContext(BigInt(chain.id), registry, epochId);
    const proofArtifact = proofArtifactOf(proveLiabilities(srs, epoch.balancePoly, epoch.balances, epoch.totalLiabilities, context));
    const suffix = epochId === 0n ? "" : "-next";
    writeJson(output, `kzg${suffix}-epoch.json`, { ...sum, registry, chainId: chain.id, epochId, context });
    writeJson(output, `kzg${suffix}-liability-proof.json`, proofArtifact);
    if (epochId === 0n) { submitted = proofArtifact; await send(company, registry, abi, "submitEpoch", [sum, proofArtifact]); }
    for (const [index, account] of accounts.entries()) {
      const proof = point(proveInclusion(srs, epoch, index, context).proof);
      const identity = identityOf(account.username, account.secretCommitment);
      writeJson(output, `kzg${suffix}-${account.username}.json`, { username: account.username, index, identity, balance: account.balance, proof });
      if (epochId === 0n) {
        assert.equal(await client.readContract({ address: registry, abi, functionName: "verifyInclusion", args: [0n, BigInt(index), identity, account.balance, proof] }), true);
        assert.equal(await client.readContract({ address: registry, abi, functionName: "verifyInclusion", args: [0n, BigInt(index), identity, account.balance + 1n, proof] }), false);
      }
    }
  }
  await proveReserve(registry, abi, reserve);
  await sampleReserves(registry, abi);
  await assert.rejects(send(company, registry, abi, "submitEpoch", [sum, submitted!]), /InvalidLiabilityProof/, "the transcript binds to the epoch, so epoch 0's proof is not a valid epoch 1");
  const connection = { rpc, registry, chainId: chain.id };
  writeJson(output, "kzg-connection.json", connection);
  console.log(`KZG: ${rpc} · ${registry}\nArtifacts: ${output}`);
  return connection;
}

if (isMain(import.meta.url)) await runKzgDemo(process.env.RPC_URL ?? "http://127.0.0.1:8547", outputDirectory());
