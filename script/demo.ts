/**
 * The whole system, end to end, asserted rather than eyeballed.
 *
 *   anvil -> deploy -> attest reserves -> build tree -> submit epoch
 *         -> customer verifies inclusion -> drain a reserve -> submission rejected
 *
 * Usage: npx tsx script/demo.ts
 */
import { formatEther, parseEther, getContract } from "viem";
import { readCustomersCsv } from "../prover/csv.ts";
import { poseidonHash } from "../prover/hash.ts";
import { buildTree, createProof, findLeafIndex } from "../prover/merkleSumTree.ts";
import { checkInclusion } from "../cli/inclusion.ts";
import { startAnvil } from "./lib/anvil.ts";
import { readArtifact } from "./lib/forge.ts";

const step = (n: number, title: string) => console.log(`\n${n}. ${title}`);
const ok = (line: string) => console.log(`   ok  ${line}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`demo failed: ${message}`);
}

const anvil = await startAnvil();
try {
  const owner = anvil.walletClient(0);
  const reserveWallets = [anvil.walletClient(1), anvil.walletClient(2)];
  const { abi, bytecode } = readArtifact("SolvencyRegistry");

  step(1, "Deploy the registry");
  const deployHash = await owner.deployContract({ abi, bytecode, args: [] });
  const { contractAddress } = await anvil.publicClient.waitForTransactionReceipt({ hash: deployHash });
  assert(contractAddress, "no contract address in the deployment receipt");
  const registry = getContract({ address: contractAddress, abi, client: { public: anvil.publicClient, wallet: owner } });
  ok(`SolvencyRegistry at ${contractAddress}`);

  step(2, "Each reserve wallet signs for itself, then the custodian lists it");
  for (const wallet of reserveWallets) {
    const address = wallet.account!.address;
    const message = (await registry.read.reserveMessage([address])) as `0x${string}`;
    const signature = await wallet.signMessage({ account: wallet.account!, message: { raw: message } });
    await anvil.publicClient.waitForTransactionReceipt({
      hash: await registry.write.addReserve([address, signature]),
    });
    ok(`${address} attested`);
  }

  // A custodian holding rather more than it owes, so the honest path passes and
  // the drained path below is a real state change rather than a rounding edge.
  await anvil.setBalance(reserveWallets[0].account!.address, parseEther("30"));
  await anvil.setBalance(reserveWallets[1].account!.address, parseEther("25"));
  ok(`reserves: ${formatEther((await registry.read.totalReserves()) as bigint)} ETH`);

  step(3, "Build the Merkle-sum tree from the private customer list");
  const entries = readCustomersCsv("./prover/customers.csv");
  const tree = buildTree(entries, poseidonHash);
  ok(`${entries.length} customers, ${tree.leaves.length} leaves, ${formatEther(tree.root.sum)} ETH owed`);

  step(4, "Publish the root");
  await anvil.publicClient.waitForTransactionReceipt({
    hash: await registry.write.submitEpoch([tree.root.hash, tree.root.sum]),
  });
  const [publishedRoot] = (await registry.read.currentEpoch()) as [bigint, bigint, bigint, bigint];
  assert(publishedRoot === tree.root.hash, "the chain stored a different root than we computed");
  ok(`epoch #${(await registry.read.epochCount()) as bigint - 1n} published`);

  step(5, "A customer checks their own balance is inside that root");
  const proof = createProof(findLeafIndex(tree, "customer-123"), tree);
  const result = await checkInclusion(anvil.publicClient, contractAddress, proof);
  for (const check of result.checks) ok(check.name);
  assert(result.ok, "the honest inclusion proof did not verify");

  step(6, "A stale proof from a superseded epoch is caught");
  await anvil.publicClient.waitForTransactionReceipt({
    hash: await registry.write.submitEpoch([tree.root.hash + 1n, tree.root.sum]),
  });
  const stale = await checkInclusion(anvil.publicClient, contractAddress, proof);
  assert(!stale.ok, "a proof against a superseded root was accepted");
  assert(stale.checks[0].ok, "the stale proof should still be internally consistent");
  ok("proof is still internally valid, but no longer matches the published root");

  step(7, "Drain a reserve and try to publish again");
  await anvil.setBalance(reserveWallets[1].account!.address, 0n);
  ok(`reserves now ${formatEther((await registry.read.totalReserves()) as bigint)} ETH against ${formatEther(tree.root.sum)} ETH owed`);
  let rejected = false;
  try {
    await registry.write.submitEpoch([tree.root.hash, tree.root.sum]);
  } catch (error) {
    rejected = String(error).includes("Insolvent");
    if (!rejected) throw error;
  }
  assert(rejected, "an insolvent epoch was accepted");
  ok("rejected with Insolvent — an insolvent epoch cannot be published at all");

  console.log("\nAll demo steps passed.");
} finally {
  anvil.stop();
}
