import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeDeployData, encodeFunctionData, createPublicClient, createTestClient, createWalletClient, http, type Abi, type Account, type Address, type Chain, type Hex, type TransactionReceipt, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const company = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const auditor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
export const maxEpochAge = 86400n;
export const minEpochInterval = 60n;
export const isMain = (url: string) => !!process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
export function outputDirectory() {
  const directory = resolve(process.env.DEMO_OUTPUT || mkdtempSync(join(tmpdir(), "opensolvency-")));
  const location = relative(process.cwd(), directory);
  if (!location.startsWith("..") && !isAbsolute(location)) throw new Error("DEMO_OUTPUT must be outside the repository so Vite cannot serve private bundles.");
  if (existsSync(directory) && readdirSync(directory).length) throw new Error("DEMO_OUTPUT must be a new or empty directory.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return resolve(directory);
}
export function writeJson(directory: string, name: string, value: unknown) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, name), JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n", { mode: 0o600 });
}
export const artifact = (source: string, name: string) => JSON.parse(readFileSync(`out/${source}/${name}.json`, "utf8"));
export type SubmitTransaction = (account: Account, label: string, request: { to?: Address; data?: Hex; value?: bigint }) => Promise<Hex>;
export function connect(transport: Transport, chain: Chain, deployer: Account, onReceipt: (label: string, receipt: TransactionReceipt) => void | Promise<void> = () => {}, onSent: (label: string, hash: Hex) => void = () => {}, submit?: SubmitTransaction) {
  const client = createPublicClient({ chain, transport });
  const wallet = (account: Account) => createWalletClient({ account, chain, transport });
  async function deploy(source: string, name: string, args: unknown[] = [], libraries: Record<string, Address> = {}, from: Account = deployer) {
    const json = artifact(source, name);
    let bytecode = (json.bytecode.object as string).replace(/^0x/, "");
    for (const names of Object.values(json.bytecode.linkReferences ?? {}) as Record<string, { start: number; length: number }[]>[]) {
      for (const [library, positions] of Object.entries(names)) {
        if (!libraries[library]) throw new Error(`Missing linked library ${library}`);
        for (const { start, length } of positions) bytecode = bytecode.slice(0, start * 2) + libraries[library].slice(2).padStart(length * 2, "0") + bytecode.slice((start + length) * 2);
      }
    }
    const hash = submit
      ? await submit(from, `deploy ${name}`, { data: encodeDeployData({ abi: json.abi as Abi, bytecode: `0x${bytecode}`, args }) })
      : await wallet(from).deployContract({ abi: json.abi as Abi, bytecode: `0x${bytecode}`, args });
    onSent(`deploy ${name}`, hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${name}`);
    await onReceipt(`deploy ${name}`, receipt);
    return receipt.contractAddress;
  }
  async function send(account: Account, address: Address, abi: Abi, functionName: string, args: unknown[]) {
    const { request } = await client.simulateContract({ account, address, abi, functionName, args });
    const hash = submit
      ? await submit(account, functionName, { to: address, data: encodeFunctionData({ abi, functionName, args }) })
      : await wallet(account).writeContract(request);
    onSent(functionName, hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    await onReceipt(functionName, receipt);
    return receipt;
  }
  return { client, wallet, artifact, deploy, send };
}
export async function demoChain(rpc: string) {
  const url = new URL(rpc);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Demo keys may only be used with a local Anvil node.");
  const transport = http(rpc, { timeout: 10000 });
  const probe = createPublicClient({ transport });
  if (!(await probe.request({ method: "web3_clientVersion" })).toLowerCase().includes("anvil")) throw new Error("The demo requires Anvil.");
  const chain = { ...foundry, id: await probe.getChainId() };
  const { client, wallet, artifact, deploy, send } = connect(transport, chain, company);
  const deployDirectory = () => deploy("ReserveDirectory.sol", "ReserveDirectory", [], {}, auditor);
  async function proveReserve(registry: Address, abi: Abi, reserve: ReturnType<typeof privateKeyToAccount>) {
    const digest = await client.readContract({ address: registry, abi, functionName: "reserveDigest", args: [reserve.address] }) as Hex;
    await send(company, registry, abi, "proveReserve", [reserve.address, await reserve.sign({ hash: digest })]);
  }
  async function approveReserve(registry: Address, abi: Abi, reserve: ReturnType<typeof privateKeyToAccount>) {
    await send(company, registry, abi, "proposeReserve", [reserve.address]);
    await proveReserve(registry, abi, reserve);
    await send(auditor, registry, abi, "reviewReserve", [reserve.address, true]);
  }
  const testClient = createTestClient({ mode: "anvil", chain, transport });
  async function sampleReserves(registry: Address, abi: Abi) {
    await send(auditor, registry, abi, "sampleReserves", []);
    await testClient.mine({ blocks: 1 });
  }
  async function advance(seconds: bigint) {
    await testClient.increaseTime({ seconds: Number(seconds) });
    await testClient.mine({ blocks: 1 });
  }
  return { rpc, chain, client, wallet, artifact, deploy, deployDirectory, send, proveReserve, approveReserve, sampleReserves, advance };
}
