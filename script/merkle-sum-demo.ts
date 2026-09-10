// Development only: run against a separate local Anvil instance on port 8545.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { buildSplitLiabilities, verifyCustomer } from "../prover/keccak/splitLiabilities.ts";
const transport = http("http://127.0.0.1:8545");
const publicClient = createPublicClient({ chain: foundry, transport });
assert.equal(await publicClient.getChainId(), 31337, "local Anvil only");
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet = createWalletClient({ account, chain: foundry, transport });
const customers = JSON.parse(readFileSync("fixtures/split-customers.example.json", "utf8")).map((c: any) => ({ ...c, amounts: c.amounts.map(BigInt) }));
const { randomBytes } = await import("node:crypto");
const { ledger, bundles } = buildSplitLiabilities(customers, `0x${randomBytes(32).toString("hex")}`);
const artifact = JSON.parse(readFileSync("out/MerkleSumRegistry.sol/MerkleSumRegistry.json", "utf8"));
const receipt = await publicClient.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [[account.address]] }) });
assert.equal(receipt.status, "success");
const address = receipt.contractAddress!;
const submit = await wallet.writeContract({ address, abi: artifact.abi, functionName: "submitLedger", args: [ledger.snapshotId, ledger.entries.map(e => e.identityHash), ledger.entries.map(e => e.balance)] });
assert.equal((await publicClient.waitForTransactionReceipt({ hash: submit })).status, "success");
const [rootHash, totalLiabilities] = await publicClient.readContract({ address, abi: artifact.abi, functionName: "currentEpoch" }) as [bigint, bigint, bigint];
assert.equal(rootHash, ledger.rootHash);
assert.equal(totalLiabilities, 120n);
for (let i = 0; i < bundles.length; i++) {
  const expected = customers[i].amounts.reduce((a: bigint, b: bigint) => a + b, 0n);
  assert.ok(verifyCustomer(bundles[i], expected, { ...ledger, rootHash, totalLiabilities }));
}
await assert.rejects(publicClient.simulateContract({ account, address, abi: artifact.abi, functionName: "submitEpoch", args: [ledger.rootHash, 1n] }));
console.log(`Registry: ${address}\nVerified TS/Solidity root, all customer balances and rejection of a false-total legacy submission.`);

