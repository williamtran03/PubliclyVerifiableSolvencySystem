import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  toHex,
  createTestClient,
  type Abi,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { fetchSnapshot, type Snapshot } from "../prover/fetchSnapshot.ts";
import { prepareEpoch } from "../prover/buildMultiAssetTree.ts";
import { createBundle, epochContext, parseHoldingsCsv, verifyBundle, type Customer } from "../prover/multiAssetTree.ts";

const MAX_EPOCH_AGE = 86_400n;
const MIN_EPOCH_INTERVAL = 60n;

const company = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const auditor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const CIRCUIT = "arms/zk-circuit/circuit";

type LinkReferences = Record<string, Record<string, { start: number; length: number }[]>>;

function artifact(source: string, name: string) {
  const path = `out/${source}/${name}.json`;
  if (!existsSync(path)) throw new Error(`${path} missing; run forge build first`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  return {
    abi: json.abi as Abi,
    bytecode: json.bytecode.object as Hex,
    linkReferences: json.bytecode.linkReferences as LinkReferences,
  };
}

function link(bytecode: Hex, references: LinkReferences, libraries: Record<string, Address>): Hex {
  let hex = bytecode.slice(2);
  for (const file of Object.values(references)) {
    for (const [name, positions] of Object.entries(file)) {
      for (const { start, length } of positions) {
        const address = libraries[name].slice(2).padStart(length * 2, "0");
        hex = hex.slice(0, start * 2) + address + hex.slice((start + length) * 2);
      }
    }
  }
  return `0x${hex}`;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function prove(proverToml: string, workDir: string): Hex {
  const name = `e2e-${process.pid}-${Date.now()}`;
  const toml = join(CIRCUIT, `${name}.toml`);
  writeFileSync(toml, proverToml);
  try {
    execFileSync("nargo", ["execute", "--prover-name", name, name], { cwd: CIRCUIT, stdio: "ignore" });
    const bb = (args: string[]) => execFileSync("bb", args, { cwd: CIRCUIT, stdio: "ignore" });
    const vk = join(workDir, "vk");
    if (!existsSync(join(vk, "vk"))) {
      bb(["write_vk", "-s", "ultra_honk", "-b", "target/circuit_multiasset.json", "-o", vk, "--oracle_hash", "keccak"]);
    }
    const out = join(workDir, name);
    bb([
      "prove", "-s", "ultra_honk", "-b", "target/circuit_multiasset.json", "-w", `target/${name}.gz`,
      "-o", out, "-k", join(vk, "vk"), "--oracle_hash", "keccak",
    ]);
    return toHex(readFileSync(join(out, "proof")));
  } finally {
    rmSync(toml, { force: true });
    rmSync(join(CIRCUIT, "target", `${name}.gz`), { force: true });
  }
}

test("Anvil: signed reserve, auditor approval, real proof per epoch, customer verification", async () => {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--silent"], { stdio: "ignore" });
  let spawnError: Error | undefined;
  anvil.on("error", (error) => (spawnError = error));
  const workDir = mkdtempSync(join(tmpdir(), "zk-e2e-"));

  try {
    const publicClient = createPublicClient({ chain: foundry, transport: http(rpc) });
    for (let i = 0; ; i++) {
      if (spawnError) throw spawnError;
      try {
        await publicClient.getChainId();
        break;
      } catch {
        if (i === 100) throw new Error("anvil did not start");
        await delay(50);
      }
    }

    const wallet = (account: Account) => createWalletClient({ account, chain: foundry, transport: http(rpc) });
    const registryAbi = artifact("MultiAssetSolvencyRegistry.sol", "MultiAssetSolvencyRegistry").abi;
    const testClient = createTestClient({ mode: "anvil", chain: foundry, transport: http(rpc) });
    const tokenAbi = artifact("DemoMocks.sol", "MockToken").abi;

    async function deploy(source: string, name: string, args: unknown[] = [], libraries: Record<string, Address> = {}, from: Account = company) {
      const { abi, bytecode, linkReferences } = artifact(source, name);
      const linked = link(bytecode, linkReferences, libraries);
      const hash = await wallet(from).deployContract({ abi, bytecode: linked, args });
      const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
      return contractAddress!;
    }

    async function send(account: Account, address: Address, abi: Abi, functionName: string, args: unknown[]) {
      const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
      const hash = await wallet(account).writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", functionName);
    }

    const directory = await deploy("ReserveDirectory.sol", "ReserveDirectory", [], {}, auditor);
    const btc = await deploy("DemoMocks.sol", "MockToken");
    const usdc = await deploy("DemoMocks.sol", "MockToken");
    const feeds = [
      await deploy("DemoMocks.sol", "MockAggregator", [8, 60_000n * 10n ** 8n]),
      await deploy("DemoMocks.sol", "MockAggregator", [8, 3_000n * 10n ** 8n]),
      await deploy("DemoMocks.sol", "MockAggregator", [8, 99_986_506n]), // USDC at $0.99986506
    ];
    const verifier = await deploy("MultiAssetHonkVerifier.sol", "HonkVerifier", [], {
      RelationsLib: await deploy("MultiAssetHonkVerifier.sol", "RelationsLib"),
      ZKTranscriptLib: await deploy("MultiAssetHonkVerifier.sol", "ZKTranscriptLib"),
    });
    const assets = [
      { token: btc, feed: feeds[0], decimals: 8, maxPriceAge: 3600 },
      { token: "0x0000000000000000000000000000000000000000", feed: feeds[1], decimals: 18, maxPriceAge: 3600 },
      { token: usdc, feed: feeds[2], decimals: 6, maxPriceAge: 86400 },
    ];
    const registry = await deploy("MultiAssetSolvencyRegistry.sol", "MultiAssetSolvencyRegistry", [
      company.address,
      auditor.address,
      assets,
      verifier,
      MAX_EPOCH_AGE,
      MIN_EPOCH_INTERVAL,
      directory,
    ]);
    const read = (functionName: string, args: unknown[] = []) =>
      publicClient.readContract({ address: registry, abi: registryAbi, functionName, args }) as Promise<any>;

    const reserve = privateKeyToAccount(generatePrivateKey());
    await send(company, btc, tokenAbi, "mint", [reserve.address, 3n * 10n ** 8n]);
    await send(company, usdc, tokenAbi, "mint", [reserve.address, 6000n * 10n ** 6n]);
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(company).sendTransaction({ to: reserve.address, value: parseEther("12") }),
    });

    await send(company, registry, registryAbi, "proposeReserve", [reserve.address]);
    await assert.rejects(send(auditor, registry, registryAbi, "reviewReserve", [reserve.address, true]), /BadReserve/);

    const directoryNonce = (await publicClient.readContract({
      address: directory,
      abi: artifact("ReserveDirectory.sol", "ReserveDirectory").abi,
      functionName: "nonces",
      args: [reserve.address],
    })) as bigint;
    async function control(nonce: bigint) {
      const challenge = (await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "windowChallenge",
      })) as Hex;
      const typedData = {
        domain: { name: "ReserveDirectory", version: "1", chainId: foundry.id, verifyingContract: directory },
        types: {
          ReserveControl: [
            { name: "wallet", type: "address" },
            { name: "registry", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "challenge", type: "bytes32" },
          ],
        },
        primaryType: "ReserveControl",
        message: { wallet: reserve.address, registry, nonce, challenge },
      } as const;
      return { challenge, typedData };
    }
    const proveControl = async (nonce: bigint) => {
      const { typedData } = await control(nonce);
      await send(company, registry, registryAbi, "proveReserve", [reserve.address, await reserve.signTypedData(typedData)]);
    };
    const sample = async () => {
      await send(auditor, registry, registryAbi, "sampleReserves", []);
      await testClient.mine({ blocks: 1 });
    };

    const first = await control(directoryNonce);
    const forged = await privateKeyToAccount(generatePrivateKey()).signTypedData(first.typedData);
    await assert.rejects(
      send(company, registry, registryAbi, "proveReserve", [reserve.address, forged]),
      /InvalidSignature/,
    );
    await proveControl(directoryNonce);

    assert.deepEqual(await read("reserveUnits"), [0n, 0n, 0n], "proven but unapproved reserves do not count");
    await assert.rejects(send(company, registry, registryAbi, "reviewReserve", [reserve.address, true]), /NotAuditor/);
    await send(auditor, registry, registryAbi, "reviewReserve", [reserve.address, true]);
    assert.deepEqual(await read("reserveUnits"), [0n, 0n, 0n], "nothing counts before the auditor samples");
    await sample();

    const holdings = parseHoldingsCsv(readFileSync("arms/zk-circuit/prover/customers.csv", "utf8"));
    const seed = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

    const snapshot: Snapshot = await fetchSnapshot(rpc, registry);
    assert.deepEqual(snapshot.reserveUnits, [3_00000000n, 12_00000000n, 6000_00000000n], "base units, 8 decimals");
    assert.equal(snapshot.pricesUsd[2], 99_986_506n, "sub-dollar prices keep their decimals");
    assert.equal(snapshot.context, epochContext(31337n, registry, 0n), "TS and Solidity agree on the context");

    const epoch0 = prepareEpoch(holdings, snapshot, seed());
    const proof0 = prove(epoch0.proverToml, workDir);
    const submit = (account: Account, proof: Hex, epoch: typeof epoch0, roundIds = snapshot.roundIds) =>
      send(account, registry, registryAbi, "submitEpoch", [proof, epoch.rootHash, epoch.floors, roundIds]);

    await assert.rejects(submit(auditor, proof0, epoch0), /NotCompany/);
    await submit(company, proof0, epoch0);

    const onChain = await read("getEpoch", [0n]);
    assert.equal(onChain.rootHash, epoch0.rootHash);
    assert.deepEqual(onChain.reserveUnits, [3_00000000n, 12_00000000n, 6000_00000000n]);
    assert.deepEqual(onChain.roundIds, snapshot.roundIds);
    assert.equal(onChain.assetsUsd, 216_000n * 10n ** 8n + 6000n * 99_986_506n);

    for (const username of new Set(holdings.map((h) => h.username))) {
      const own = holdings.filter((h) => h.username === username);
      const customer: Customer = {
        username,
        salt: own[0].salt,
        expectedAmounts: new Map(own.map((h) => [h.assetId, h.amount])),
      };
      const bundle = createBundle(username, epoch0.padded, epoch0.levels);
      assert.ok(verifyBundle(bundle, customer, onChain.rootHash, onChain.context), username);

      const tampered = structuredClone(bundle);
      tampered.parts[0].holding.amount += 1n;
      assert.equal(verifyBundle(tampered, customer, onChain.rootHash, onChain.context), false, `${username} tampered`);
      assert.equal(
        verifyBundle(bundle, { ...customer, salt: customer.salt + 1n }, onChain.rootHash, onChain.context),
        false,
        `${username} with someone else's salt`,
      );
    }

    await assert.rejects(submit(company, proof0, epoch0), /ReservesNotSampled/);
    await testClient.increaseTime({ seconds: Number(MIN_EPOCH_INTERVAL) });
    await testClient.mine({ blocks: 1 });
    await proveControl(directoryNonce + 1n);
    await sample();
    const snapshot1 = await fetchSnapshot(rpc, registry);
    assert.equal(snapshot1.epochId, 1n);
    const epoch1 = prepareEpoch(holdings, snapshot1, seed());
    await submit(company, prove(epoch1.proverToml, workDir), epoch1, snapshot1.roundIds);
    assert.equal(await read("epochCount"), 2n);
    assert.equal(await read("isCurrent"), true);
    assert.ok((await read("epochAge")) < MAX_EPOCH_AGE);
    assert.equal((await read("getEpoch", [0n])).rootHash, epoch0.rootHash);
    assert.equal((await read("latestEpoch")).rootHash, epoch1.rootHash);

    await testClient.increaseTime({ seconds: Number(MIN_EPOCH_INTERVAL) });
    await testClient.mine({ blocks: 1 });
    await proveControl(directoryNonce + 2n);
    await sample();
    await send(auditor, registry, registryAbi, "removeReserve", [reserve.address]);
    await assert.rejects(submit(company, proof0, epoch1), /Insolvent/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    anvil.kill("SIGTERM");
    if (anvil.exitCode === null) await new Promise((resolve) => anvil.once("exit", resolve));
  }
});
