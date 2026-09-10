import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi, isAddress, type Hex } from "viem";
import { buildSplitLiabilities, verifyCustomer, verifyPublicLedger, type Customer, type CustomerBundle, type PublicLedger } from "../prover/keccak/splitLiabilities.ts";

const bigintKeys = new Set(["balance", "identityHash", "rootHash", "rootSum", "totalLiabilities"]);
export function parseArtifact(text: string): any {
  return JSON.parse(text, (key, value) => {
    if (bigintKeys.has(key)) return BigInt(value);
    if (key === "siblingHashes" || key === "siblingSums") return value.map(BigInt);
    return value;
  });
}
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const abi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 totalLiabilities, uint64 timestamp)",
  "function currentSnapshotId() view returns (bytes32)",
]);
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "build") {
    const [input, output] = args;
    if (!input || !output) throw new Error("build <private customers.json> <new output directory>");
    const raw = JSON.parse(readFileSync(input, "utf8"));
    const customers: Customer[] = raw.map((c: any) => {
      if (![c.customerId, c.name, c.dateOfBirth].every(v => typeof v === "string")) throw new Error("identity fields must be strings");
      return { ...c, amounts: c.amounts.map((v: unknown) => {
        if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v)) throw new Error("amounts must be decimal strings in wei");
        return BigInt(v);
      }) };
    });
    const snapshotId = `0x${randomBytes(32).toString("hex")}` as Hex;
    const { ledger, bundles } = buildSplitLiabilities(customers, snapshotId);
    if (ledger.entries.length > 256) throw new Error("contract prototype supports at most 256 parts");
    // Fail if directory exists, so a rebuild cannot silently replace customer openings.
    mkdirSync(output, { mode: 0o700 });
    mkdirSync(resolve(output, "private"), { mode: 0o700 });
    writeFileSync(resolve(output, "ledger.json"), json(ledger), { mode: 0o600 });
    bundles.forEach((b, i) => writeFileSync(resolve(output, "private", `customer-${i}.json`), json(b), { mode: 0o600 }));
    console.log(`Built ${bundles.length} customer bundles; publish only ledger.json. Total: ${ledger.totalLiabilities} wei.`);
  } else if (command === "audit") {
    const [path] = args;
    const ledger: PublicLedger = parseArtifact(readFileSync(path, "utf8"));
    if (!verifyPublicLedger(ledger)) throw new Error("invalid public ledger");
    console.log("VALID: published entries produce the claimed root and total. Completeness and assets are separate checks.");
  } else if (command === "verify") {
    const [address, rpc, path, expectedBalance, expectedCustomerId] = args;
    if (!isAddress(address ?? "") || !rpc || !path || !expectedBalance || !expectedCustomerId) throw new Error("verify <registry> <RPC URL> <private bundle.json> <expected balance in wei> <customer ID>");
    const client = createPublicClient({ transport: http(rpc) });
    // Pin both reads to a single block to avoid mixing two epochs.
    const blockNumber = await client.getBlockNumber();
    const [rootHash, totalLiabilities] = await client.readContract({ address: address as Hex, abi, functionName: "currentEpoch", blockNumber });
    const snapshotId = await client.readContract({ address: address as Hex, abi, functionName: "currentSnapshotId", blockNumber });
    const bundle: CustomerBundle = parseArtifact(readFileSync(path, "utf8"));
    if (bundle.customerId !== expectedCustomerId || !verifyCustomer(bundle, BigInt(expectedBalance), { rootHash, totalLiabilities, snapshotId })) throw new Error("customer verification failed");
    console.log("VALID: your expected full balance is included in the on-chain snapshot. This is not a guarantee of undisclosed debts or current reserves.");
  } else throw new Error("Commands: build, audit, verify (see docs/merkle-sum.md)");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
