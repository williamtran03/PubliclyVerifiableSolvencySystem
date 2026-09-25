import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { http, isHex, keccak256, TransactionReceiptNotFoundError, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { artifact, auditor as anvilAuditor, company as anvilCompany, connect, type SubmitTransaction } from "../demo/chain.ts";
import { saveRecord } from "./record.ts";
import { broadcastJournaled, finalizeTransaction, type PendingTransaction } from "./journal.ts";

export const ARMS = {
  "published-ledger": { source: "MerkleSumRegistry.sol", name: "MerkleSumRegistry", reserveKey: "LEDGER_RESERVE_PRIVATE_KEY" },
  "zk-circuit": { source: "MultiAssetSolvencyRegistry.sol", name: "MultiAssetSolvencyRegistry", reserveKey: "ZK_RESERVE_PRIVATE_KEY" },
  snarkless: { source: "KzgSolvencyRegistry.sol", name: "KzgSolvencyRegistry", reserveKey: "KZG_RESERVE_PRIVATE_KEY" },
} as const;
export type Arm = keyof typeof ARMS;
export const armNames = Object.keys(ARMS) as Arm[];

export const FEEDS = {
  BTC: { feed: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43", description: "BTC / USD", maxPriceAge: 7200 },
  ETH: { feed: "0x694AA1769357215DE4FAC081bf1f309aDC325306", description: "ETH / USD", maxPriceAge: 7200 },
  USDC: { feed: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E", description: "USDC / USD", maxPriceAge: 172800 },
} as const;

type Transaction = { step: string; hash: Hex; block: string; gasUsed: string };
export type Deployment = {
  network: "sepolia";
  chainId: number;
  roles: { company: Address; auditor: Address };
  parameters: { maxEpochAge: string; minEpochInterval: string };
  contracts: Record<string, Address>;
  reserves: Partial<Record<Arm, Address>>;
  deployBlocks: Record<string, string>;
  epochs: { arm: Arm; epochId: string; hash: Hex; block: string; gasUsed: string; timestamp: string }[];
  transactions: Transaction[];
  operations?: Partial<Record<Arm, number>>;
  pending?: PendingTransaction;
};

function privateKey(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing. Copy .env.example to .env and fill it in (see scripts/sepolia/README.md).`);
  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(key) || key.length !== 66) throw new Error(`${name} must be a 32-byte hex private key.`);
  return key;
}

function seconds(name: string, fallback: bigint) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number of seconds.`);
  return BigInt(value);
}

export function privateOutput(...parts: string[]) {
  const directory = resolve(process.env.PRIVATE_OUTPUT || join(homedir(), "opensolvency-sepolia"), ...parts);
  const location = relative(process.cwd(), directory);
  if (!location.startsWith("..") && !isAbsolute(location)) throw new Error("PRIVATE_OUTPUT must be outside the repository: it holds customer bundles and secrets.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function writePrivate(directory: string, name: string, value: unknown) {
  writeFileSync(join(directory, name), JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n", { mode: 0o600, flush: true });
}

export async function sepoliaNetwork() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  if (!rpc || !/^https?:\/\//.test(rpc)) throw new Error("SEPOLIA_RPC_URL is missing or not an HTTP(S) URL.");
  const company = privateKeyToAccount(privateKey("COMPANY_PRIVATE_KEY"));
  const auditor = privateKeyToAccount(privateKey("AUDITOR_PRIVATE_KEY"));
  const reserves = Object.fromEntries(armNames.map(arm => [arm, privateKeyToAccount(privateKey(ARMS[arm].reserveKey))])) as Record<Arm, PrivateKeyAccount>;
  const addresses = [company, auditor, ...Object.values(reserves)].map(account => account.address);
  if (new Set(addresses).size !== addresses.length) throw new Error("Company, auditor and the three reserve wallets need five different keys: the directory gives a reserve wallet to one registry at a time.");
  if ([anvilCompany.address, anvilAuditor.address].some(address => addresses.includes(address))) throw new Error("Public Anvil development keys must not hold roles on a public network.");
  const maxEpochAge = seconds("MAX_EPOCH_AGE", 2592000n);
  const minEpochInterval = seconds("MIN_EPOCH_INTERVAL", 60n);
  if (maxEpochAge === 0n || minEpochInterval > maxEpochAge) throw new Error("MIN_EPOCH_INTERVAL must not exceed MAX_EPOCH_AGE, and MAX_EPOCH_AGE must be positive.");

  const file = resolve(process.env.DEPLOYMENT_FILE || "deployments/sepolia.json");
  const record: Deployment = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {
    network: "sepolia", chainId: sepolia.id,
    roles: { company: company.address, auditor: auditor.address },
    parameters: { maxEpochAge: maxEpochAge.toString(), minEpochInterval: minEpochInterval.toString() },
    contracts: {}, reserves: {}, deployBlocks: {}, epochs: [], transactions: [],
  };
  if (record.roles.company !== company.address || record.roles.auditor !== auditor.address) throw new Error(`${file} was deployed with other company or auditor keys.`);
  const save = () => saveRecord(file, record);

  let step = "";
  const transport = http(rpc, { timeout: 30000, retryCount: 3 });
  const persist = (next: Deployment) => saveRecord(file, next);
  const submit: SubmitTransaction = async (account, label, request) => {
    if (record.pending) throw new Error("Recover the pending transaction before sending another.");
    const signer = wallet(account);
    const prepared = await signer.prepareTransactionRequest({ ...request, account });
    const serializedTransaction = await signer.signTransaction(prepared);
    const hash = keccak256(serializedTransaction);
    const epochId = (label === "submitEpoch" || label === "submitLedger") && armNames.includes(step as Arm)
      ? (await read<bigint>(step as Arm, "epochCount")).toString() : undefined;
    return broadcastJournaled(record, persist, {
      step, label, hash, serializedTransaction, sender: account.address, nonce: prepared.nonce, epochId,
    }, raw => client.sendRawTransaction({ serializedTransaction: raw }));
  };
  const onReceipt = async (_label: string, receipt: TransactionReceipt) => {
    const pending = record.pending;
    if (!pending) throw new Error("Missing pending transaction.");
    let epoch: Deployment["epochs"][number] | undefined;
    if (receipt.status === "success" && (pending.label === "submitEpoch" || pending.label === "submitLedger") && armNames.includes(pending.step as Arm)) {
      const arm = pending.step as Arm;
      const epochId = pending.epochId ?? ((await client.readContract({ address: registryOf(arm), abi: abiOf(arm), functionName: "epochCount", blockNumber: receipt.blockNumber }) as bigint) - 1n).toString();
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      epoch = { arm, epochId, hash: receipt.transactionHash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), timestamp: block.timestamp.toString() };
    }
    finalizeTransaction(record, persist, receipt, epoch);
  };
  const { client, wallet, deploy, send } = connect(transport, sepolia, company, onReceipt, undefined, submit);
  const chainId = await client.getChainId();
  if (chainId !== sepolia.id) throw new Error(`SEPOLIA_RPC_URL serves chain ${chainId}, not Sepolia (${sepolia.id}).`);

  const abiOf = (arm: Arm) => artifact(ARMS[arm].source, ARMS[arm].name).abi as Abi;
  const registryOf = (arm: Arm) => {
    const address = record.contracts[arm];
    if (!address) throw new Error(`${arm} is not deployed yet. Run npm run sepolia -- deploy first.`);
    return address;
  };
  const read = <T>(arm: Arm, functionName: string, args: unknown[] = []) =>
    client.readContract({ address: registryOf(arm), abi: abiOf(arm), functionName, args }) as Promise<T>;
  async function transfer(to: Address, value: bigint) {
    const hash = await submit(company, "transfer", { to, value });
    const receipt = await client.waitForTransactionReceipt({ hash });
    await onReceipt("transfer", receipt);
    if (receipt.status !== "success") throw new Error(`Transfer to ${to} failed`);
  }
  async function recover() {
    const pending = record.pending;
    if (pending) {
      let receipt = await client.getTransactionReceipt({ hash: pending.hash }).catch(error => {
        if (error instanceof TransactionReceiptNotFoundError) return undefined;
        throw error;
      });
      if (!receipt) {
        if (!pending.serializedTransaction || !pending.sender || pending.nonce === undefined) {
          throw new Error(`Legacy pending transaction ${pending.hash} has no signed journal. Resolve it manually; it will not be discarded.`);
        }
        if (keccak256(pending.serializedTransaction) !== pending.hash) throw new Error("Signed transaction hash mismatch.");
        const mined = await client.getTransactionCount({ address: pending.sender, blockTag: "latest" });
        if (mined > pending.nonce) throw new Error(`Nonce ${pending.nonce} was consumed but receipt ${pending.hash} is unavailable. Check for a replacement; the journal is retained.`);
        try {
          await client.sendRawTransaction({ serializedTransaction: pending.serializedTransaction });
        } catch (error) {
          const known = await client.getTransaction({ hash: pending.hash }).catch(() => undefined);
          if (!known) throw error;
        }
        receipt = await client.waitForTransactionReceipt({ hash: pending.hash });
      }
      await onReceipt(pending.label, receipt);
      console.log(`${pending.step} ${pending.label}: recovered ${receipt.status} transaction ${pending.hash}.`);
    }
    for (const account of [company, auditor, ...Object.values(reserves)]) {
      const [mined, sent] = await Promise.all([
        client.getTransactionCount({ address: account.address, blockTag: "latest" }),
        client.getTransactionCount({ address: account.address, blockTag: "pending" }),
      ]);
      if (sent > mined) throw new Error(`${account.address} has a transaction in the mempool. Wait until it is mined or replaced, then run the command again.`);
    }
  }
  async function blockAfter(block: bigint) {
    while (await client.getBlockNumber({ cacheTime: 0 }) <= block) await delay(3000);
  }
  return {
    rpc, file, record, save, client, wallet, deploy, send, transfer, recover, blockAfter, read, abiOf, registryOf,
    company, auditor, reserves, chainId: BigInt(chainId),
    maxEpochAge: BigInt(record.parameters.maxEpochAge), minEpochInterval: BigInt(record.parameters.minEpochInterval),
    setStep(value: string) { step = value; },
  };
}
export type Network = Awaited<ReturnType<typeof sepoliaNetwork>>;
