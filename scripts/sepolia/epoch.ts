import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toHex, type Address, type Hex, type TransactionReceipt } from "viem";
import { buildSplitLiabilities, type Customer as LedgerCustomer } from "../../arms/published-ledger/prover/splitLiabilities.ts";
import { fetchSnapshot } from "../../arms/zk-circuit/prover/fetchSnapshot.ts";
import { prepareEpoch } from "../../arms/zk-circuit/prover/buildMultiAssetTree.ts";
import { createBundle, parseHoldingsCsv } from "../../arms/zk-circuit/prover/multiAssetTree.ts";
import { prove } from "../../arms/zk-circuit/prover/prove.ts";
import { loadSrs, type G1Point } from "../../arms/snarkless/prover/srs.ts";
import { buildGrandSumEpoch, epochContext, identityOf, proveInclusion, type Account } from "../../arms/snarkless/prover/grandSum.ts";
import { proveRange } from "../../arms/snarkless/prover/range.ts";
import { ledger } from "../../open-solvency/src/solutions/ledger.ts";
import { zk } from "../../open-solvency/src/solutions/zk.ts";
import { kzg } from "../../open-solvency/src/solutions/kzg.ts";
import type { Solution } from "../../open-solvency/src/types.ts";
import { proveReserve } from "./deploy.ts";
import { privateOutput, writePrivate, type Arm, type Network } from "./network.ts";

type Check = { file: string; account: string; expected: Map<number, bigint>; secret: string };
const point = (p: G1Point) => p.toAffine();

export async function nextEpochOpensAt(network: Network, arm: Arm) {
  const last = await network.read<bigint>(arm, "lastEpochAt");
  return last === 0n ? 0n : last + network.minEpochInterval;
}

async function prepareReserves(network: Network, arm: Arm) {
  const { auditor, registryOf, abiOf, read, reserves } = network;
  const opens = await nextEpochOpensAt(network, arm);
  const now = (await network.client.getBlock()).timestamp;
  if (now < opens) throw new Error(`${arm}: the registry accepts the next epoch from ${new Date(Number(opens) * 1000).toISOString()}.`);
  if (await read<number>(arm, "reserveStatus", [reserves[arm].address]) !== 3) throw new Error(`${arm}: the reserve is not approved. Run npm run sepolia -- deploy first.`);
  const window = await read<bigint>(arm, "window");
  let reproven = false;
  if (await read<bigint>(arm, "confirmedWindow", [reserves[arm].address]) !== window) {
    await proveReserve(network, arm);
    reproven = true;
  }
  const sampled = await read<bigint>(arm, "sampledWindow") === window;
  if (sampled && reproven) await network.send(auditor, registryOf(arm), abiOf(arm), "discardSample", []);
  if (!sampled || reproven) await network.send(auditor, registryOf(arm), abiOf(arm), "sampleReserves", []);
  await network.blockAfter(await read<bigint>(arm, "sampledBlock"));
}

async function publishLedger(network: Network, epochId: bigint, output: string) {
  const customers: LedgerCustomer[] = JSON.parse(readFileSync("arms/published-ledger/fixtures/customers.example.json", "utf8")).map((c: any) => ({
    ...c, parts: c.parts.map((p: any) => ({ assetId: p.assetId, amount: BigInt(p.amount) })),
  }));
  const built = buildSplitLiabilities(customers, toHex(randomBytes(32)), 2);
  const receipt = await network.send(network.company, network.registryOf("published-ledger"), network.abiOf("published-ledger"), "submitLedger", [
    built.ledger.snapshotId, built.ledger.assets.map(a => a.entries.map(e => e.identityHash)), built.ledger.assets.map(a => a.entries.map(e => e.balance)),
  ]);
  writePrivate(output, "ledger.json", built.ledger);
  const checks = customers.map((customer, i) => {
    writePrivate(output, `${customer.customerId}.json`, built.bundles[i]);
    const expected = new Map<number, bigint>();
    for (const part of customer.parts) expected.set(part.assetId, (expected.get(part.assetId) ?? 0n) + part.amount);
    return { file: `${customer.customerId}.json`, account: customer.customerId, expected, secret: "" };
  });
  return { receipt, checks };
}

async function publishZk(network: Network, epochId: bigint, output: string) {
  const registry = network.registryOf("zk-circuit");
  const snapshot = await fetchSnapshot(network.rpc, registry);
  if (snapshot.epochId !== epochId) throw new Error("zk-circuit: the epoch changed while preparing the proof.");
  const holdings = parseHoldingsCsv(readFileSync("arms/zk-circuit/prover/customers.csv", "utf8"));
  const prepared = prepareEpoch(holdings, snapshot, toHex(randomBytes(32)));
  const workDir = mkdtempSync(join(tmpdir(), "zk-sepolia-"));
  let proof: Hex;
  try {
    console.log(`zk-circuit: proving epoch ${epochId} with nargo and bb`);
    proof = prove(prepared.proverToml, workDir);
  } finally { rmSync(workDir, { recursive: true, force: true }); }
  const [, roundIds] = await network.read<[bigint[], bigint[]]>("zk-circuit", "readPrices");
  const receipt = await network.send(network.company, registry, network.abiOf("zk-circuit"), "submitEpoch", [proof, prepared.rootHash, prepared.floors, roundIds]);
  const checks: Check[] = [];
  for (const username of new Set(holdings.map(h => h.username))) {
    writePrivate(output, `${username}.json`, createBundle(username, prepared.padded, prepared.levels));
    const own = holdings.filter(h => h.username === username);
    checks.push({ file: `${username}.json`, account: username, expected: new Map(own.map(h => [h.assetId, h.amount])), secret: own[0].salt.toString() });
  }
  return { receipt, checks };
}

async function publishKzg(network: Network, epochId: bigint, output: string) {
  const registry = network.registryOf("snarkless");
  const srs = loadSrs("arms/snarkless/fixtures/srs.json");
  const accounts: Account[] = readFileSync("shared/customers.csv", "utf8").trim().split("\n").slice(1).map(row => {
    const [username, balance, salt] = row.split(",");
    return { username, balance: BigInt(balance), salt: BigInt(salt) };
  });
  const context = epochContext(network.chainId, registry, epochId);
  const epoch = buildGrandSumEpoch(srs, accounts);
  const range = proveRange(srs, epoch.balancePoly, epoch.balances, context);
  const sum = { balanceCommitment: point(epoch.balanceCommitment), shiftedCommitment: point(epoch.shiftedCommitment), identityCommitment: point(epoch.identityCommitment), totalLiabilities: epoch.totalLiabilities, sumProof: point(epoch.opening.proof) };
  const rangeArtifact = { bitCommitments: range.bitCommitments.map(point), quotientCommitment: point(range.quotientCommitment), values: range.values, batchProof: point(range.batchProof) };
  const receipt = await network.send(network.company, registry, network.abiOf("snarkless"), "submitEpoch", [sum, rangeArtifact]);
  writePrivate(output, "epoch.json", { ...sum, registry, chainId: network.chainId, epochId, context });
  writePrivate(output, "range-proof.json", rangeArtifact);
  const checks = accounts.map((account, index) => {
    writePrivate(output, `${account.username}.json`, { username: account.username, index, identity: identityOf(account.username, account.salt), balance: account.balance, proof: point(proveInclusion(srs, epoch, index, context).proof) });
    return { file: `${account.username}.json`, account: account.username, expected: new Map([[0, account.balance]]), secret: account.salt.toString() };
  });
  return { receipt, checks };
}

const publishers: Record<Arm, (network: Network, epochId: bigint, output: string) => Promise<{ receipt: TransactionReceipt; checks: Check[] }>> = {
  "published-ledger": publishLedger, "zk-circuit": publishZk, snarkless: publishKzg,
};
const solutions: Record<Arm, Solution> = { "published-ledger": ledger, "zk-circuit": zk, snarkless: kzg };

export async function publishEpoch(network: Network, arm: Arm) {
  network.setStep(arm);
  await prepareReserves(network, arm);
  const epochId = await network.read<bigint>(arm, "epochCount");
  const output = privateOutput(arm, `epoch-${epochId}`);
  const { receipt, checks } = await publishers[arm](network, epochId, output);
  const block = await network.client.getBlock({ blockNumber: receipt.blockNumber });
  network.record.epochs.push({ arm, epochId: epochId.toString(), hash: receipt.transactionHash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), timestamp: block.timestamp.toString() });
  network.save();
  network.setStep("");

  const connection = { rpc: network.rpc, registry: network.registryOf(arm) as Address };
  const snapshot = await solutions[arm].read(connection);
  if (snapshot.epoch !== epochId) throw new Error(`${arm}: the site reads epoch ${snapshot.epoch}, expected ${epochId}.`);
  for (const check of checks) {
    const file = readFileSync(join(output, check.file), "utf8");
    const result = await solutions[arm].verify(connection, snapshot, file, check.account, check.expected, check.secret);
    const wrong = new Map(check.expected);
    const [asset, amount] = [...wrong.entries()][0];
    wrong.set(asset, amount + 1n);
    const tampered = await solutions[arm].verify(connection, snapshot, file, check.account, wrong, check.secret);
    if (!result.valid || tampered.valid) throw new Error(`${arm}: the site adapter does not verify ${check.account} correctly.`);
  }
  console.log(`${arm}: epoch ${epochId} published in block ${receipt.blockNumber} (${receipt.gasUsed} gas); ${checks.length} customers verified through the site adapter. Bundles: ${output}`);
}
