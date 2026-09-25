import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, http } from "viem";
import { deployedNetworks } from "../../open-solvency/src/networks.ts";
import type { PublicExample, PublicExamples } from "../../open-solvency/src/examples.ts";
import { ledger } from "../../open-solvency/src/solutions/ledger.ts";
import { zk } from "../../open-solvency/src/solutions/zk.ts";
import { kzg } from "../../open-solvency/src/solutions/kzg.ts";
import { saveRecord } from "./record.ts";
import { publicSampleBundle, samples } from "./sample.ts";

if (process.argv.slice(2).join(" ") !== "--publish-synthetic-example") {
  throw new Error("Usage: npm run demo:export -- --publish-synthetic-example (deliberately exports the documented fictional customers).");
}
if (existsSync(".env")) process.loadEnvFile(".env");
const record = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE || "deployments/sepolia.json", "utf8"));
const network = deployedNetworks([record])[0];
if (!network) throw new Error("A complete Sepolia deployment record without pending transactions is required.");
const rpc = process.env.SEPOLIA_RPC_URL || network.connections.snarkless.rpc;
if (await createPublicClient({ transport: http(rpc) }).getChainId() !== 11155111) throw new Error("The RPC must serve Sepolia.");
const privateRoot = resolve(process.env.PRIVATE_OUTPUT || join(homedir(), "opensolvency-sepolia"));
const examples: PublicExample[] = [];
for (const solution of [ledger, zk, kzg]) {
  const connection = { ...network.connections[solution.id], rpc };
  const snapshot = await solution.read(connection);
  if (!snapshot.freshness?.current) throw new Error(`${solution.id}: publish a fresh epoch before exporting.`);
  const sample = samples[solution.id];
  const file = join(privateRoot, solution.id, `epoch-${snapshot.epoch}`, `${sample.account}.json`);
  const bundle = publicSampleBundle(solution.id, JSON.parse(readFileSync(file, "utf8")));
  const text = JSON.stringify(bundle);
  const balances = new Map(sample.balances.map(([asset, amount]) => [asset, BigInt(amount)]));
  const valid = await solution.verify(connection, snapshot, text, sample.account, balances, sample.secret);
  const wrong = new Map(balances);
  wrong.set(0, wrong.get(0)! + 1n);
  const invalid = await solution.verify(connection, snapshot, text, sample.account, wrong, sample.secret);
  if (!valid.valid || invalid.valid) throw new Error(`${solution.id}: sample verification failed.`);
  const latest = await solution.read(connection);
  if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("Epoch changed during export; retry with the latest bundles.");
  examples.push({ method: solution.id, registry: connection.registry, epoch: snapshot.epoch.toString(), commitment: snapshot.commitment, ...sample, bundle });
}
const output: PublicExamples = { version: 1, chainId: 11155111, examples };
saveRecord("open-solvency/public-examples/sepolia.json", output);
console.log("Exported three verified fictional examples. Review the file, commit it, and rebuild the website. No RPC credentials or other customer bundles were copied.");
