import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi, isAddress, type Hex } from "viem";
import { buildSplitLiabilities, verifyCustomer, verifyPublicLedger, type Customer, type CustomerBundle, type PublicLedger } from "../prover/splitLiabilities.ts";

const USAGE = `Commands:
  build <customers.json> <new output directory> <asset count>
  audit <ledger.json>
  verify <registry> <RPC URL> <private bundle.json> <customer ID> <assetId:amount>...`;

const bigintKeys = new Set(["amount", "balance", "identityHash", "rootHash", "rootSum", "totalLiabilities"]);
export function parseArtifact(text: string): any {
  return JSON.parse(text, (key, value) => {
    if (bigintKeys.has(key)) return BigInt(value);
    if (key === "siblingHashes" || key === "siblingSums") return value.map(BigInt);
    return value;
  });
}
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const abi = parseAbi([
  "struct Epoch { bytes32 snapshotId; uint256[] rootHashes; uint256[] liabilities; uint256[] reserves; uint64 timestamp; }",
  "function latestEpoch() view returns (Epoch)",
]);

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "build") {
    const [input, output, assetCount] = args;
    if (!input || !output || !assetCount) throw new Error(USAGE);
    const raw = JSON.parse(readFileSync(input, "utf8"));
    const customers: Customer[] = raw.map((c: any) => {
      if (![c.customerId, c.name, c.dateOfBirth].every(v => typeof v === "string")) throw new Error("identity fields must be strings");
      return { ...c, parts: c.parts.map((p: any) => {
        if (typeof p.amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(p.amount)) throw new Error("amounts must be decimal strings in base units");
        return { assetId: Number(p.assetId), amount: BigInt(p.amount) };
      }) };
    });
    const snapshotId = `0x${randomBytes(32).toString("hex")}` as Hex;
    const { ledger, bundles } = buildSplitLiabilities(customers, snapshotId, Number(assetCount));
    if (ledger.assets.some((a) => a.entries.length > 256)) throw new Error("contract prototype supports at most 256 parts per asset");
    mkdirSync(output, { mode: 0o700 });
    mkdirSync(resolve(output, "private"), { mode: 0o700 });
    writeFileSync(resolve(output, "ledger.json"), json(ledger), { mode: 0o600 });
    bundles.forEach((b, i) => writeFileSync(resolve(output, "private", `customer-${i}.json`), json(b), { mode: 0o600 }));
    console.log(`Built ${bundles.length} customer bundles; publish only ledger.json. Totals per asset: ${ledger.assets.map((a) => a.totalLiabilities).join(", ")}.`);
  } else if (command === "audit") {
    const [path] = args;
    if (!path) throw new Error(USAGE);
    const ledger: PublicLedger = parseArtifact(readFileSync(path, "utf8"));
    if (!verifyPublicLedger(ledger)) throw new Error("invalid public ledger");
    console.log("VALID: published entries produce the claimed roots and totals. Completeness and assets are separate checks.");
  } else if (command === "verify") {
    const [address, rpc, path, expectedCustomerId, ...expectations] = args;
    if (!isAddress(address ?? "") || !rpc || !path || !expectedCustomerId || expectations.length === 0) throw new Error(USAGE);
    const expected = new Map(expectations.map((pair) => {
      const [assetId, amount] = pair.split(":");
      if (!/^\d+$/.test(assetId ?? "") || !/^\d+$/.test(amount ?? "")) throw new Error(`expected assetId:amount, got ${pair}`);
      return [Number(assetId), BigInt(amount)] as const;
    }));
    const client = createPublicClient({ transport: http(rpc) });
    const epoch = await client.readContract({ address: address as Hex, abi, functionName: "latestEpoch" });
    const published = {
      snapshotId: epoch.snapshotId,
      assets: epoch.rootHashes.map((rootHash, i) => ({ rootHash, totalLiabilities: epoch.liabilities[i] })),
    };
    const bundle: CustomerBundle = parseArtifact(readFileSync(path, "utf8"));
    if (bundle.customerId !== expectedCustomerId || !verifyCustomer(bundle, expected, published)) throw new Error("customer verification failed");
    console.log("VALID: every asset balance you expected is included in the latest on-chain snapshot. This says nothing about undisclosed debts or later reserves.");
  } else throw new Error(USAGE);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
