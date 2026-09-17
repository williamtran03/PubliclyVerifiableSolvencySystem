import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Abi } from "viem";
import { loadSrs, g2ForPrecompile, type G1Point } from "../prover/srs.ts";
import { buildGrandSumEpoch, epochContext, identityOf, proveInclusion, type Account } from "../prover/grandSum.ts";
import { proveRange } from "../prover/range.ts";
import { auditor, company, demoChain, isMain, maxEpochAge, outputDirectory, writeJson } from "../../../scripts/demo/chain.ts";

const point = (p: G1Point) => p.toAffine();

export async function runKzgDemo(rpc: string, output: string) {
  const { client, artifact, deploy, send, approveReserve, chain } = await demoChain(rpc);
  const srs = loadSrs("arms/snarkless/fixtures/srs.json");
  const g2 = (p: typeof srs.g2) => {
    const [xImag, xReal, yImag, yReal] = g2ForPrecompile(p);
    return { xImag, xReal, yImag, yReal };
  };
  const token = await deploy("DemoAsset.sol", "DemoAsset", ["TEST", 0]);
  const abi = artifact("KzgSolvencyRegistry.sol", "KzgSolvencyRegistry").abi as Abi;
  const registry = await deploy("KzgSolvencyRegistry.sol", "KzgSolvencyRegistry", [company.address, auditor.address, token, 0, { g2: g2(srs.g2), tauG2: g2(srs.tauG2), boundG2: g2(srs.boundG2) }, maxEpochAge]);
  const reserve = privateKeyToAccount(generatePrivateKey());
  await send(company, token, artifact("DemoAsset.sol", "DemoAsset").abi, "mint", [reserve.address, 50000n]);
  await approveReserve(registry, abi, reserve);
  const accounts: Account[] = readFileSync("shared/customers.csv", "utf8").trim().split("\n").slice(1).map(row => {
    const [username, balance, salt] = row.split(",");
    return { username, balance: BigInt(balance), salt: BigInt(salt) };
  });
  const epoch = buildGrandSumEpoch(srs, accounts);
  const sum = { balanceCommitment: point(epoch.balanceCommitment), shiftedCommitment: point(epoch.shiftedCommitment), identityCommitment: point(epoch.identityCommitment), totalLiabilities: epoch.totalLiabilities, sumProof: point(epoch.opening.proof) };
  for (const epochId of [0n, 1n]) {
    const context = epochContext(BigInt(chain.id), registry, epochId);
    const range = proveRange(srs, epoch.balancePoly, epoch.balances, context);
    const rangeArtifact = { bitCommitments: range.bitCommitments.map(point), quotientCommitment: point(range.quotientCommitment), values: range.values, batchProof: point(range.batchProof) };
    const suffix = epochId === 0n ? "" : "-next";
    writeJson(output, `kzg${suffix}-epoch.json`, { ...sum, registry, chainId: chain.id, epochId, context });
    writeJson(output, `kzg${suffix}-range-proof.json`, rangeArtifact);
    if (epochId === 0n) await send(company, registry, abi, "submitEpoch", [sum, rangeArtifact]);
    for (const [index, account] of accounts.entries()) {
      const proof = point(proveInclusion(srs, epoch, index, context).proof);
      const identity = identityOf(account.username, account.salt);
      writeJson(output, `kzg${suffix}-${account.username}.json`, { username: account.username, index, identity, balance: account.balance, proof });
      if (epochId === 0n) {
        assert.equal(await client.readContract({ address: registry, abi, functionName: "verifyInclusion", args: [0n, BigInt(index), identity, account.balance, proof] }), true);
        assert.equal(await client.readContract({ address: registry, abi, functionName: "verifyInclusion", args: [0n, BigInt(index), identity, account.balance + 1n, proof] }), false);
      }
    }
  }
  const connection = { rpc, registry, chainId: chain.id };
  writeJson(output, "kzg-connection.json", connection);
  console.log(`KZG: ${rpc} · ${registry}\nArtifacts: ${output}`);
  return connection;
}

if (isMain(import.meta.url)) await runKzgDemo(process.env.RPC_URL ?? "http://127.0.0.1:8547", outputDirectory());
