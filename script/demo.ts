/**
 * The whole system, end to end, asserted rather than eyeballed.
 *
 *   anvil -> deploy verifier + registry -> attest reserves -> build tree
 *         -> publish root *with a validity proof* -> customer verifies inclusion
 *         -> understated total rejected -> drained reserve rejected
 *
 * Expects `npx tsx script/prove.ts` to have produced fixtures/zk-proof.json.
 *
 * Usage: npx tsx script/demo.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { formatEther, getContract, parseEther, type Hex } from "viem";
import { checkInclusion } from "../cli/inclusion.ts";
import { readCustomersCsv } from "../prover/csv.ts";
import { poseidonHash } from "../prover/hash.ts";
import { buildTree, createProof, findLeafIndex } from "../prover/merkleSumTree.ts";
import { startAnvil } from "./lib/anvil.ts";
import { libraryNames, linkBytecode, readArtifact } from "./lib/forge.ts";

const step = (n: number, title: string) => console.log(`\n${n}. ${title}`);
const ok = (line: string) => console.log(`   ok  ${line}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`demo failed: ${message}`);
}

async function expectRejection(promise: Promise<unknown>, what: string): Promise<void> {
  try {
    await promise;
  } catch {
    ok(what);
    return;
  }
  throw new Error(`demo failed: ${what} — but it was accepted`);
}

if (!existsSync("fixtures/zk-proof.json")) {
  throw new Error("fixtures/zk-proof.json is missing — run `make prove` first");
}
const zk = JSON.parse(readFileSync("fixtures/zk-proof.json", "utf8")) as {
  rootHash: string;
  totalLiabilities: string;
  proof: Hex;
};

const anvil = await startAnvil();
try {
  const owner = anvil.walletClient(0);
  const reserveWallets = [anvil.walletClient(1), anvil.walletClient(2)];

  step(1, "Deploy the generated verifier and the registry that requires it");
  const verifierArtifact = readArtifact("HonkVerifier");

  // The generated verifier is split across external libraries and ships with
  // unlinked placeholders, so those go up first.
  const libraries: Record<string, `0x${string}`> = {};
  for (const name of libraryNames(verifierArtifact)) {
    const artifact = readArtifact("HonkVerifier", name);
    const receipt = await anvil.publicClient.waitForTransactionReceipt({
      hash: await owner.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [] }),
    });
    assert(receipt.contractAddress, `${name} deployment produced no address`);
    libraries[name] = receipt.contractAddress;
    ok(`library ${name} at ${receipt.contractAddress}`);
  }

  const verifierReceipt = await anvil.publicClient.waitForTransactionReceipt({
    hash: await owner.deployContract({
      abi: verifierArtifact.abi,
      bytecode: linkBytecode(verifierArtifact, libraries),
      args: [],
    }),
  });
  assert(verifierReceipt.contractAddress, "verifier deployment produced no address");

  const registryArtifact = readArtifact("ZkSolvencyRegistry");
  const registryReceipt = await anvil.publicClient.waitForTransactionReceipt({
    hash: await owner.deployContract({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode,
      args: [verifierReceipt.contractAddress],
    }),
  });
  const address = registryReceipt.contractAddress;
  assert(address, "registry deployment produced no address");

  const registry = getContract({
    address,
    abi: registryArtifact.abi,
    client: { public: anvil.publicClient, wallet: owner },
  });
  ok(`HonkVerifier at ${verifierReceipt.contractAddress} (${verifierReceipt.gasUsed} gas to deploy)`);
  ok(`ZkSolvencyRegistry at ${address}`);

  step(2, "Each reserve wallet signs for itself, then the custodian lists it");
  for (const wallet of reserveWallets) {
    const walletAddress = wallet.account.address;
    const message = (await registry.read.reserveMessage([walletAddress])) as Hex;
    const signature = await wallet.signMessage({ message: { raw: message } });
    await anvil.publicClient.waitForTransactionReceipt({
      hash: await registry.write.addReserve([walletAddress, signature]),
    });
    ok(`${walletAddress} attested`);
  }
  await anvil.setBalance(reserveWallets[0].account.address, parseEther("30"));
  await anvil.setBalance(reserveWallets[1].account.address, parseEther("25"));
  ok(`reserves: ${formatEther((await registry.read.totalReserves()) as bigint)} ETH`);

  step(3, "Rebuild the tree and check it against the proof's public inputs");
  const entries = readCustomersCsv("./prover/customers.csv");
  const tree = buildTree(entries, poseidonHash);
  assert(BigInt(zk.rootHash) === tree.root.hash, "fixtures/zk-proof.json is for a different tree — re-run `make prove`");
  assert(BigInt(zk.totalLiabilities) === tree.root.sum, "fixtures/zk-proof.json has a different total — re-run `make prove`");
  ok(`${entries.length} customers, ${tree.leaves.length} leaves, ${formatEther(tree.root.sum)} ETH owed`);

  step(4, "Publish the root, with the proof that the tree behind it is well-formed");
  const receipt = await anvil.publicClient.waitForTransactionReceipt({
    hash: await registry.write.submitEpoch([tree.root.hash, tree.root.sum, zk.proof]),
  });
  ok(`epoch published, ${receipt.gasUsed} gas (proof is ${(zk.proof.length - 2) / 2} bytes)`);

  step(5, "A customer checks their own balance is inside that root");
  const proof = createProof(findLeafIndex(tree, "customer-123"), tree);
  const result = await checkInclusion(anvil.publicClient, address, proof);
  for (const check of result.checks) ok(check.name);
  assert(result.ok, "the honest inclusion proof did not verify");

  step(6, "The same proof cannot be reused to understate the total");
  await expectRejection(
    registry.write.submitEpoch([tree.root.hash, tree.root.sum - parseEther("10"), zk.proof]),
    "10 ETH shaved off the total: rejected, the total is a public input to the proof",
  );
  await expectRejection(
    registry.write.submitEpoch([tree.root.hash, tree.root.sum]),
    "root submitted with no proof at all: rejected",
  );

  step(7, "Drain a reserve and try to publish again");
  await anvil.setBalance(reserveWallets[1].account.address, 0n);
  ok(`reserves now ${formatEther((await registry.read.totalReserves()) as bigint)} ETH against ${formatEther(tree.root.sum)} ETH owed`);
  await expectRejection(
    registry.write.submitEpoch([tree.root.hash, tree.root.sum, zk.proof]),
    "a valid proof over an honest tree still cannot make an insolvent epoch publishable",
  );

  console.log("\nAll demo steps passed.");
} finally {
  anvil.stop();
}
