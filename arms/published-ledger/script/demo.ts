import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Abi, type Hex } from "viem";
import { buildSplitLiabilities, verifyCustomer, type Customer } from "../prover/splitLiabilities.ts";
import { auditor, company, demoChain, isMain, maxEpochAge, outputDirectory, writeJson } from "../../../scripts/demo/chain.ts";

export async function runLedgerDemo(rpc: string, output: string) {
  const { client, wallet, artifact, deploy, send, approveReserve, chain } = await demoChain(rpc);
  const reserve = privateKeyToAccount(generatePrivateKey());
  const tokenAbi = artifact("DemoAsset.sol", "DemoAsset").abi as Abi;
  const abi = artifact("MerkleSumRegistry.sol", "MerkleSumRegistry").abi as Abi;
  const token = await deploy("DemoAsset.sol", "DemoAsset", ["TEST", 0]);
  const registry = await deploy("MerkleSumRegistry.sol", "MerkleSumRegistry", [
    company.address, auditor.address,
    ["0x0000000000000000000000000000000000000000", token], maxEpochAge,
  ]);
  await send(company, token, tokenAbi, "mint", [reserve.address, 3n]);
  const funding = await client.waitForTransactionReceipt({ hash: await wallet(company).sendTransaction({ to: reserve.address, value: 120n }) });
  assert.equal(funding.status, "success");
  await approveReserve(registry, abi, reserve);
  const customers: Customer[] = JSON.parse(readFileSync("arms/published-ledger/fixtures/customers.example.json", "utf8")).map((c: any) => ({
    ...c, parts: c.parts.map((p: any) => ({ assetId: p.assetId, amount: BigInt(p.amount) })),
  }));
  const snapshot = () => `0x${randomBytes(32).toString("hex")}` as Hex;
  const { ledger, bundles } = buildSplitLiabilities(customers, snapshot(), 2);
  const calldata = (value: typeof ledger) => [value.snapshotId, value.assets.map(a => a.entries.map(e => e.identityHash)), value.assets.map(a => a.entries.map(e => e.balance))];
  await send(company, registry, abi, "submitLedger", calldata(ledger));
  const epoch = await client.readContract({ address: registry, abi, functionName: "latestEpoch" }) as any;
  assert.deepEqual(epoch.rootHashes, ledger.assets.map(a => a.rootHash));
  assert.deepEqual(epoch.liabilities, ledger.assets.map(a => a.totalLiabilities));
  assert.deepEqual(epoch.liabilities, [120n, 3n], "the funded reserves exactly cover the fixture's liabilities");
  const published = { snapshotId: epoch.snapshotId, assets: epoch.rootHashes.map((rootHash: bigint, i: number) => ({ rootHash, totalLiabilities: epoch.liabilities[i] })) };
  for (const [i, customer] of customers.entries()) {
    const expected = new Map<number, bigint>();
    for (const part of customer.parts) expected.set(part.assetId, (expected.get(part.assetId) ?? 0n) + part.amount);
    assert.ok(verifyCustomer(bundles[i], expected, published));
    writeJson(output, `ledger-${customer.customerId}.json`, bundles[i]);
  }
  const short = buildSplitLiabilities(customers.map(c => ({ ...c, parts: c.parts.map(p => p.assetId === 1 ? { ...p, amount: 4n } : p) })), snapshot(), 2);
  await assert.rejects(send(company, registry, abi, "submitLedger", calldata(short.ledger)), /Insolvent/);
  writeJson(output, "ledger.json", ledger);
  // A distinct, valid next epoch for exercising the browser wallet path.
  const next = buildSplitLiabilities(customers, snapshot(), 2);
  writeJson(output, "ledger-next.json", next.ledger);
  next.bundles.forEach(b => writeJson(output, `ledger-next-${b.customerId}.json`, b));
  const connection = { rpc, registry, chainId: chain.id };
  writeJson(output, "ledger-connection.json", connection);
  console.log(`Merkle-Sum Tree: ${rpc} · ${registry}\nArtifacts: ${output}`);
  return connection;
}

if (isMain(import.meta.url)) await runLedgerDemo(process.env.RPC_URL ?? "http://127.0.0.1:8545", outputDirectory());
