/**
 * The whole system, end to end, asserted rather than eyeballed.
 *
 *   anvil -> deploy -> attest reserves -> commit to liabilities
 *         -> publish the total with its grand sum opening (verified on-chain)
 *         -> customer verifies inclusion (on-chain, free, no wallet)
 *         -> anyone verifies the range argument (off-chain, pinned by hash)
 *         -> understated total rejected -> drained reserve rejected
 *
 * Usage: npx tsx script/demo.ts
 */
import { formatEther, getContract, keccak256, parseEther, toBytes, type Hex } from "viem";
import { checkInclusion } from "../cli/inclusion.ts";
import { readCustomersCsv } from "../prover/csv.ts";
import { Fr, nthRootOfUnity } from "../prover/kzg/field.ts";
import { buildEpoch, verifyEpoch } from "../prover/kzg/grandSum.ts";
import { g1ToJson, g2ToPrecompileJson, rangeProofToJson } from "../prover/kzg/json.ts";
import { verifyRange } from "../prover/kzg/range.ts";
import { loadSrs } from "../prover/kzg/srs.ts";
import { startAnvil } from "./lib/anvil.ts";
import { readArtifact } from "./lib/forge.ts";

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

const point = (p: ReturnType<typeof g1ToJson>) => [BigInt(p[0]), BigInt(p[1])] as const;

const srs = loadSrs("fixtures/srs.json");
const entries = readCustomersCsv("./prover/customers.csv");
const { epoch, proofs } = buildEpoch(srs, entries);

const anvil = await startAnvil();
try {
  const owner = anvil.walletClient(0);
  const reserveWallets = [anvil.walletClient(1), anvil.walletClient(2)];

  step(1, "Deploy the registry with the SRS's G2 elements baked in");
  const artifact = readArtifact("KzgSolvencyRegistry");
  const receipt = await anvil.publicClient.waitForTransactionReceipt({
    hash: await owner.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args: [
        BigInt(epoch.n),
        nthRootOfUnity(epoch.n),
        Fr.inv(Fr.create(BigInt(epoch.n))),
        g2ToPrecompileJson(srs.g2).map(BigInt),
        g2ToPrecompileJson(srs.tauG2).map(BigInt),
      ],
    }),
  });
  const address = receipt.contractAddress;
  assert(address, "registry deployment produced no address");
  const registry = getContract({
    address,
    abi: artifact.abi,
    client: { public: anvil.publicClient, wallet: owner },
  });
  ok(`KzgSolvencyRegistry at ${address} (${receipt.gasUsed} gas to deploy)`);

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

  step(3, "Commit to the liabilities as one polynomial");
  assert(verifyEpoch(srs, epoch).ok, "the epoch we just built does not verify locally");
  const rangeProofFile = rangeProofToJson(epoch.rangeProof) + "\n";
  const rangeProofHash = keccak256(toBytes(rangeProofFile));
  ok(`${entries.length} customers over a domain of ${epoch.n}, ${formatEther(epoch.totalLiabilities)} ETH owed`);
  ok(`range argument: ${epoch.rangeProof.bits} bit polynomials, ${rangeProofFile.length} bytes`);

  step(4, "Publish the total, proven by a single opening at zero");
  const submitted = await anvil.publicClient.waitForTransactionReceipt({
    hash: await registry.write.submitEpoch([
      point(g1ToJson(epoch.balanceCommitment)),
      point(g1ToJson(epoch.idCommitment)),
      epoch.totalLiabilities,
      point(g1ToJson(epoch.grandSumProof)),
      rangeProofHash,
    ]),
  });
  ok(`epoch published, ${submitted.gasUsed} gas — one pairing check, no SNARK`);

  step(5, "A customer verifies inclusion, on-chain and for free");
  const mine = proofs.find((proof) => proof.username === "customer-123");
  assert(mine, "customer-123 has no proof");
  const result = await checkInclusion(anvil.publicClient, address, mine);
  for (const check of result.checks) ok(check.name);
  assert(result.ok, "the honest inclusion proof did not verify");

  step(6, "Anyone verifies that no balance is secretly negative");
  const pinned = keccak256(toBytes(rangeProofFile));
  const [, , , , onChainHash] = (await registry.read.currentCommitment()) as [
    bigint, bigint, bigint, bigint, Hex,
  ];
  assert(pinned === onChainHash, "the chain pinned a different range proof");
  ok("the published artifact is the one the chain committed to");
  assert(
    verifyRange(srs, epoch.balanceCommitment, epoch.n, epoch.rangeProof),
    "the range argument did not verify",
  );
  ok("every balance is a 128-bit non-negative number");

  step(7, "The things that must not work");
  await expectRejection(
    registry.write.submitEpoch([
      point(g1ToJson(epoch.balanceCommitment)),
      point(g1ToJson(epoch.idCommitment)),
      epoch.totalLiabilities - parseEther("10"),
      point(g1ToJson(epoch.grandSumProof)),
      rangeProofHash,
    ]),
    "10 ETH shaved off the total: rejected by the pairing check",
  );
  const inflated = (await registry.read.verifyInclusion([
    BigInt(mine.index),
    mine.id,
    mine.balance + 1n,
    point(g1ToJson(mine.proof)),
  ])) as boolean;
  assert(!inflated, "a customer inflated their own balance");
  ok("a customer claiming a larger balance than they have: rejected");

  step(8, "Drain a reserve and try to publish again");
  await anvil.setBalance(reserveWallets[1].account.address, 0n);
  ok(`reserves now ${formatEther((await registry.read.totalReserves()) as bigint)} ETH against ${formatEther(epoch.totalLiabilities)} ETH owed`);
  await expectRejection(
    registry.write.submitEpoch([
      point(g1ToJson(epoch.balanceCommitment)),
      point(g1ToJson(epoch.idCommitment)),
      epoch.totalLiabilities,
      point(g1ToJson(epoch.grandSumProof)),
      rangeProofHash,
    ]),
    "a perfectly valid commitment still cannot make an insolvent epoch publishable",
  );

  console.log("\nAll demo steps passed.");
} finally {
  anvil.stop();
}
