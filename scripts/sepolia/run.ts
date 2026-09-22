import { execFileSync } from "node:child_process";
import { checkProvingTools } from "../../arms/zk-circuit/prover/toolchain.ts";
import { formatEther } from "viem";
import { deploy } from "./deploy.ts";
import { nextEpochOpensAt, publishEpoch } from "./epoch.ts";
import { armNames, sepoliaNetwork, type Arm, type Network } from "./network.ts";

const usage = "Usage: npm run sepolia -- deploy | epoch [published-ledger] [zk-circuit] [snarkless] | status";

async function status(network: Network) {
  const { client, record, company, auditor } = network;
  for (const [role, account] of [["company", company], ["auditor", auditor]] as const) {
    console.log(`${role} ${account.address}: ${formatEther(await client.getBalance({ address: account.address }))} ETH`);
  }
  const now = (await client.getBlock()).timestamp;
  const rows = [];
  for (const arm of armNames) {
    const registry = record.contracts[arm];
    if (!registry) { rows.push({ arm, registry: "not deployed" }); continue; }
    const read = <T>(name: string, args: unknown[] = []) => network.read<T>(arm, name, args);
    const [epochs, current, lapses, window, sampledWindow] = await Promise.all([
      read<bigint>("epochCount"), read<boolean>("isCurrent"), read<bigint>("lapses"), read<bigint>("window"), read<bigint>("sampledWindow"),
    ]);
    const reserve = network.reserves[arm].address;
    const opens = await nextEpochOpensAt(network, arm);
    rows.push({
      arm, registry, epochs: Number(epochs), current, lapses: Number(lapses),
      reserveProven: await read<bigint>("confirmedWindow", [reserve]) === window,
      sampled: sampledWindow === window,
      nextEpoch: opens <= now ? "open" : new Date(Number(opens) * 1000).toISOString(),
    });
  }
  console.table(rows);
  console.log(`Deployment record: ${network.file}`);
}

const [command, ...rest] = process.argv.slice(2);
if (!["deploy", "epoch", "status"].includes(command)) {
  console.error(usage);
  process.exit(1);
}
const arms = (rest.length ? rest : armNames) as Arm[];
const unknown = arms.filter(arm => !armNames.includes(arm));
if (unknown.length) throw new Error(`Unknown arm ${unknown.join(", ")}. ${usage}`);

try {
  execFileSync("forge", ["build"], { stdio: "pipe" });
} catch (error) {
  process.stderr.write((error as { stderr?: Buffer }).stderr ?? "");
  throw new Error("forge build failed.");
}
try {
  if (command === "epoch" && arms.includes("zk-circuit")) checkProvingTools();
  const network = await sepoliaNetwork();
  if (command === "deploy") await deploy(network);
  if (command === "epoch") for (const arm of arms) await publishEpoch(network, arm);
  await status(network);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
