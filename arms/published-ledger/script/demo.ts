import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http, parseEther, type Abi, type Account, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { buildSplitLiabilities, verifyCustomer, type Customer } from "../prover/splitLiabilities.ts";

const transport = http("http://127.0.0.1:8545");
const publicClient = createPublicClient({ chain: foundry, transport });
assert.equal(await publicClient.getChainId(), 31337, "local Anvil only");
const company = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const auditor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const reserve = privateKeyToAccount(generatePrivateKey());
const wallet = (account: Account) => createWalletClient({ account, chain: foundry, transport });

const artifact = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const registryArtifact = artifact("out/MerkleSumRegistry.sol/MerkleSumRegistry.json");
const tokenArtifact = artifact("out/MockToken.sol/MockToken.json");
const abi = registryArtifact.abi as Abi;

async function deploy(json: any, args: unknown[]): Promise<Address> {
  const hash = await wallet(company).deployContract({ abi: json.abi, bytecode: json.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt.contractAddress!;
}
async function send(account: Account, address: Address, contractAbi: Abi, functionName: string, args: unknown[]) {
  const { request } = await publicClient.simulateContract({ account, address, abi: contractAbi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await wallet(account).writeContract(request) });
  assert.equal(receipt.status, "success", functionName);
}

const token = await deploy(tokenArtifact, []);
const address = await deploy(registryArtifact, [company.address, auditor.address, ["0x0000000000000000000000000000000000000000", token]]);
console.log(`Registry: ${address}`);

await send(company, token, tokenArtifact.abi, "mint", [reserve.address, 3n]);
await publicClient.waitForTransactionReceipt({ hash: await wallet(company).sendTransaction({ to: reserve.address, value: 120n }) });
await send(company, address, abi, "proposeReserve", [reserve.address]);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
const signature = await reserve.signTypedData({
  domain: { name: "MerkleSumRegistry", version: "1", chainId: foundry.id, verifyingContract: address },
  types: { ReserveControl: [{ name: "wallet", type: "address" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }] },
  primaryType: "ReserveControl",
  message: { wallet: reserve.address, nonce: 0n, expiry },
});
await send(company, address, abi, "proveReserve", [reserve.address, expiry, signature]);
await send(auditor, address, abi, "reviewReserve", [reserve.address, true]);
console.log("Reserve proposed by the company, signed by the wallet, approved by the auditor.");

const customers: Customer[] = JSON.parse(readFileSync("arms/published-ledger/fixtures/customers.example.json", "utf8")).map((c: any) => ({
  ...c,
  parts: c.parts.map((p: any) => ({ assetId: p.assetId, amount: BigInt(p.amount) })),
}));
const snapshot = () => `0x${randomBytes(32).toString("hex")}` as Hex;
const { ledger, bundles } = buildSplitLiabilities(customers, snapshot(), 2);
const calldata = (l: typeof ledger) => [l.snapshotId, l.assets.map((a) => a.entries.map((e) => e.identityHash)), l.assets.map((a) => a.entries.map((e) => e.balance))];
await send(company, address, abi, "submitLedger", calldata(ledger));

const epoch = (await publicClient.readContract({ address, abi, functionName: "latestEpoch" })) as any;
assert.deepEqual(epoch.rootHashes, ledger.assets.map((a) => a.rootHash), "TS and Solidity roots agree");
assert.deepEqual(epoch.liabilities, [120n, 3n]);
const published = { snapshotId: epoch.snapshotId, assets: epoch.rootHashes.map((rootHash: bigint, i: number) => ({ rootHash, totalLiabilities: epoch.liabilities[i] })) };
for (const [i, customer] of customers.entries()) {
  const expected = new Map<number, bigint>();
  for (const part of customer.parts) expected.set(part.assetId, (expected.get(part.assetId) ?? 0n) + part.amount);
  assert.ok(verifyCustomer(bundles[i], expected, published), customer.customerId);
}
console.log("Verified TS/Solidity roots per asset and every customer's balances.");

await publicClient.waitForTransactionReceipt({ hash: await wallet(company).sendTransaction({ to: reserve.address, value: parseEther("1") }) });
const short = buildSplitLiabilities(
  customers.map((c) => ({ ...c, parts: c.parts.map((p) => (p.assetId === 1 ? { ...p, amount: 4n } : p)) })),
  snapshot(),
  2,
);
await assert.rejects(send(company, address, abi, "submitLedger", calldata(short.ledger)), /Insolvent/);
console.log("Rejected a ledger short in one asset despite a surplus in the other.");
