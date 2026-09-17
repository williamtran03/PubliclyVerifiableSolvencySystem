// Stands the KZG arm up on a local Anvil end to end.
//
// The Fiat-Shamir transcript binds every proof to keccak(chainId, registry,
// epochId), so the epoch has to be built *after* the registry exists. The order
// below is the whole point of this script: deploy, record the address, prove,
// submit. The SRS is independent of that context and comes from srs.json, so
// the registry can be constructed before any proof exists.
//
// Artifacts land in a demo directory; the committed fixtures under
// arms/snarkless/fixtures/ stay bound to the address the Foundry tests use.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http, type Abi, type Account, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { g2ForPrecompile, loadSrs } from "../prover/srs.ts";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const OUT_DIR = process.env.OUT_DIR ?? "./arms/snarkless/fixtures/demo";
const MAX_EPOCH_AGE = 86_400n;
const DECIMALS = 0;

const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: foundry, transport });
assert.equal(await publicClient.getChainId(), 31337, "local Anvil only");
const company = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const auditor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const reserve = privateKeyToAccount(generatePrivateKey());
const wallet = (account: Account) => createWalletClient({ account, chain: foundry, transport });

const artifact = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const registryArtifact = artifact("out/KzgSolvencyRegistry.sol/KzgSolvencyRegistry.json");
const tokenArtifact = artifact("out/ReserveToken.sol/ReserveToken.json");
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
const read = (address: Address, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args });
const g1 = (p: { x: string; y: string }) => ({ x: BigInt(p.x), y: BigInt(p.y) });

// The SRS carries no epoch context, so the registry can be deployed from it first.
const srs = loadSrs("./arms/snarkless/fixtures/srs.json");
const g2 = (point: Parameters<typeof g2ForPrecompile>[0]) => {
  const [xImag, xReal, yImag, yReal] = g2ForPrecompile(point);
  return { xImag, xReal, yImag, yReal };
};
const token = await deploy(tokenArtifact, []);
const address = await deploy(registryArtifact, [
  company.address,
  auditor.address,
  token,
  DECIMALS,
  { g2: g2(srs.g2), tauG2: g2(srs.tauG2), boundG2: g2(srs.boundG2) },
  MAX_EPOCH_AGE,
]);
console.log(`Registry: ${address}`);

// Prove the reserve before the epoch: submitEpoch reverts Insolvent otherwise.
await send(company, token, tokenArtifact.abi, "mint", [reserve.address, 50_000n]);
await send(company, address, abi, "proposeReserve", [reserve.address]);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
const digest = (await read(address, "reserveDigest", [reserve.address, expiry])) as Hex;
await send(company, address, abi, "proveReserve", [reserve.address, expiry, await reserve.sign({ hash: digest })]);
await send(auditor, address, abi, "reviewReserve", [reserve.address, true]);
console.log("Reserve proposed by the company, signed by the wallet, approved by the auditor.");

// Now the address exists, so the transcript can be bound to it.
mkdirSync(OUT_DIR, { recursive: true });
const snapshotPath = `${OUT_DIR}/snapshot.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ registry: address, chainId: "31337", epochId: "0" }, null, 2)}\n`);
execFileSync("npx", ["tsx", "arms/snarkless/prover/buildEpoch.ts", snapshotPath, OUT_DIR], { stdio: "inherit" });

const epochJson = artifact(`${OUT_DIR}/epoch.json`);
const rangeJson = artifact(`${OUT_DIR}/range-proof.json`);
const inclusions = artifact(`${OUT_DIR}/inclusion.json`) as {
  username: string; index: number; identity: string; balance: string; proof: { x: string; y: string };
}[];
assert.equal(BigInt(epochJson.context), (await read(address, "epochContext", [0n])) as bigint, "context binds to this registry");

const sum = {
  balanceCommitment: g1(epochJson.balanceCommitment),
  shiftedCommitment: g1(epochJson.shiftedCommitment),
  identityCommitment: g1(epochJson.identityCommitment),
  totalLiabilities: BigInt(epochJson.totalLiabilities),
  sumProof: g1(epochJson.sumProof),
};
const range = {
  bitCommitments: rangeJson.bitCommitments.map(g1),
  quotientCommitment: g1(rangeJson.quotientCommitment),
  values: rangeJson.values.map((value: string) => BigInt(value)),
  batchProof: g1(rangeJson.batchProof),
};
await send(company, address, abi, "submitEpoch", [sum, range]);
const epoch = (await read(address, "getEpoch", [0n])) as { totalLiabilities: bigint; reserveUnits: bigint };
console.log(`Epoch 0 published: ${epoch.totalLiabilities} owed against ${epoch.reserveUnits} held.`);

for (const customer of inclusions) {
  const valid = await read(address, "verifyInclusion", [
    0n, BigInt(customer.index), BigInt(customer.identity), BigInt(customer.balance), g1(customer.proof),
  ]);
  assert.ok(valid, customer.username);
}
console.log(`The contract confirmed all ${inclusions.length} customers against the published commitment.`);

const first = inclusions[0];
const overstated = await read(address, "verifyInclusion", [
  0n, BigInt(first.index), BigInt(first.identity), BigInt(first.balance) + 1n, g1(first.proof),
]);
assert.equal(overstated, false);
console.log("Rejected the same opening claiming one unit more than the customer holds.");

await assert.rejects(send(company, address, abi, "submitEpoch", [sum, range]), /reverted|InvalidRangeProof/);
console.log("Rejected a replay of epoch 0's proof as epoch 1; the transcript binds to the epoch.");
console.log(`\nCustomer openings for the website are in ${OUT_DIR}/inclusion.json (one object per customer).`);
