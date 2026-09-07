import { spawn, type ChildProcess } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { anvil as anvilChain } from "viem/chains";

/** The mnemonic every Anvil instance uses by default. Public, and worthless. */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

export type Anvil = {
  chain: Chain;
  rpcUrl: string;
  publicClient: PublicClient;
  account: (index: number) => Account;
  walletClient: (index: number) => WalletClient<Transport, Chain, Account>;
  setBalance: (address: `0x${string}`, wei: bigint) => Promise<void>;
  stop: () => void;
};

export async function startAnvil(port = Number(process.env.ANVIL_PORT ?? 8545)): Promise<Anvil> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = { ...anvilChain, rpcUrls: { default: { http: [rpcUrl] } } };

  const child: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));

  const publicClient: PublicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `anvil exited with code ${child.exitCode}${stderr ? `: ${stderr.trim()}` : ""}\n` +
          `Is something already listening on port ${port}? Set ANVIL_PORT to pick another.`,
      );
    }
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil did not come up on ${rpcUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const account = (index: number) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index });

  return {
    chain,
    rpcUrl,
    publicClient,
    account,
    walletClient: (index: number) =>
      createWalletClient({ account: account(index), chain, transport: http(rpcUrl) }),
    setBalance: async (address, wei) => {
      await publicClient.request({
        method: "anvil_setBalance" as never,
        params: [address, `0x${wei.toString(16)}`] as never,
      });
    },
    stop: () => child.kill("SIGTERM"),
  };
}
