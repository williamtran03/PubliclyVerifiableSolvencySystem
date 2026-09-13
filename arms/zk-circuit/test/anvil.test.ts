import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Abi,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { fetchPriceTable } from "../prover/fetchPrices.ts";
import {
  buildTree,
  createProof,
  parseHoldingsCsv,
  verifyBundle,
  type CustomerBundle,
} from "../prover/multiAssetTree.ts";

// Standard anvil dev accounts 0 and 1.
const company = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const auditor = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

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

test("Anvil: signed reserve, auditor approval, prover price fetch, on-chain epoch, customer verification", async () => {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--silent"], { stdio: "ignore" });
  let spawnError: Error | undefined;
  anvil.on("error", (error) => (spawnError = error));

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
    const tokenAbi = artifact("DemoMocks.sol", "MockToken").abi;

    async function deploy(source: string, name: string, args: unknown[] = [], libraries: Record<string, Address> = {}) {
      const { abi, bytecode, linkReferences } = artifact(source, name);
      const linked = link(bytecode, linkReferences, libraries);
      const hash = await wallet(company).deployContract({ abi, bytecode: linked, args });
      const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
      return contractAddress!;
    }

    async function send(account: Account, address: Address, abi: Abi, functionName: string, args: unknown[]) {
      const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
      const hash = await wallet(account).writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", functionName);
    }

    // ---- deploy -----------------------------------------------------------
    const btc = await deploy("DemoMocks.sol", "MockToken");
    const usdc = await deploy("DemoMocks.sol", "MockToken");
    const feeds = [
      await deploy("DemoMocks.sol", "MockAggregator", [8, 60_000n * 10n ** 8n]),
      await deploy("DemoMocks.sol", "MockAggregator", [8, 3_000n * 10n ** 8n]),
      await deploy("DemoMocks.sol", "MockAggregator", [8, 10n ** 8n]),
    ];
    const verifier = await deploy("MultiAssetHonkVerifier.sol", "HonkVerifier", [], {
      RelationsLib: await deploy("MultiAssetHonkVerifier.sol", "RelationsLib"),
      ZKTranscriptLib: await deploy("MultiAssetHonkVerifier.sol", "ZKTranscriptLib"),
    });
    const assets = [
      { token: btc, feed: feeds[0], decimals: 8 },
      { token: "0x0000000000000000000000000000000000000000", feed: feeds[1], decimals: 18 },
      { token: usdc, feed: feeds[2], decimals: 6 },
    ];
    const registry = await deploy("MultiAssetSolvencyRegistry.sol", "MultiAssetSolvencyRegistry", [
      company.address,
      auditor.address,
      assets,
      verifier,
      3600n,
    ]);

    const read = (functionName: string, args: unknown[] = []) =>
      publicClient.readContract({ address: registry, abi: registryAbi, functionName, args }) as Promise<any>;

    // ---- reserve: a cold wallet with no gas, funded 3 BTC + 2 ETH + 1000 USDC = $187,000
    const reserve = privateKeyToAccount(generatePrivateKey());
    await send(company, btc, tokenAbi, "mint", [reserve.address, 3n * 10n ** 8n]);
    await send(company, usdc, tokenAbi, "mint", [reserve.address, 1000n * 10n ** 6n]);
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(company).sendTransaction({ to: reserve.address, value: parseEther("2") }),
    });

    await send(company, registry, registryAbi, "proposeReserve", [reserve.address]);
    await assert.rejects(send(auditor, registry, registryAbi, "reviewReserve", [reserve.address, true]), /BadReserve/);

    // Signed with viem's EIP-712 implementation, not the contract's own digest helper,
    // so a wrong type string or domain field in Solidity fails here.
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const typedData = {
      domain: { name: "MultiAssetSolvencyRegistry", version: "1", chainId: foundry.id, verifyingContract: registry },
      types: {
        ReserveControl: [
          { name: "wallet", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      primaryType: "ReserveControl",
      message: { wallet: reserve.address, nonce: 0n, expiry },
    } as const;

    const impostor = privateKeyToAccount(generatePrivateKey());
    const forged = await impostor.signTypedData(typedData);
    await assert.rejects(
      send(company, registry, registryAbi, "proveReserve", [reserve.address, expiry, forged]),
      /InvalidSignature/,
    );
    await send(company, registry, registryAbi, "proveReserve", [
      reserve.address,
      expiry,
      await reserve.signTypedData(typedData),
    ]);

    // ---- prover reads the table through the registry ----------------------
    const { pricesUsd, roundIds } = await fetchPriceTable(rpc, registry);
    assert.deepEqual(pricesUsd, [60_000n, 3_000n, 1n]);
    assert.equal(await read("totalAssetsUsd", [pricesUsd]), 0n, "proven but unapproved reserves do not count");

    await assert.rejects(send(company, registry, registryAbi, "reviewReserve", [reserve.address, true]), /NotAuditor/);
    await send(auditor, registry, registryAbi, "reviewReserve", [reserve.address, true]);
    assert.equal(await read("totalAssetsUsd", [pricesUsd]), 187_000n);

    // ---- prover builds the tree; it must reproduce what the committed proof attests
    const holdings = parseHoldingsCsv(readFileSync("arms/zk-circuit/prover/customers.csv", "utf8"));
    const { levels, root, holdings: padded } = buildTree(holdings, [...pricesUsd]);
    const fixture = JSON.parse(readFileSync("arms/zk-circuit/fixtures/epoch.json", "utf8"));
    assert.equal(root.hash, BigInt(fixture.rootHash), "customers.csv no longer matches fixtures/proof.bin");
    assert.equal(root.sum, BigInt(fixture.totalLiabilitiesUsd));

    const proof = `0x${readFileSync("arms/zk-circuit/fixtures/proof.bin").toString("hex")}` as Hex;
    await assert.rejects(
      send(auditor, registry, registryAbi, "submitEpoch", [proof, root.hash, root.sum, roundIds]),
      /NotCompany/,
    );
    await send(company, registry, registryAbi, "submitEpoch", [proof, root.hash, root.sum, roundIds]);

    const [epochRoot, epochLiabilities, epochAssets] = await read("currentEpoch");
    assert.equal(epochRoot, root.hash);
    assert.equal(epochLiabilities, 155_000n);
    assert.equal(epochAssets, 187_000n);
    for (let i = 0; i < 3; i++) assert.equal(await read("epochRoundIds", [BigInt(i)]), roundIds[i]);

    // ---- every customer verifies against the on-chain epoch, a tampered bundle does not
    const usernames = [...new Set(holdings.map((h) => h.username))];
    for (const username of usernames) {
      const bundle: CustomerBundle = {
        username,
        prices: pricesUsd.map(String),
        parts: padded.flatMap((h, index) => (h.username === username ? [createProof(index, padded, levels)] : [])),
      };
      const expected = new Map<number, bigint>();
      for (const h of holdings.filter((h) => h.username === username)) {
        expected.set(h.assetId, (expected.get(h.assetId) ?? 0n) + h.amount);
      }
      assert.ok(verifyBundle(bundle, expected, epochRoot, epochLiabilities), username);

      const tampered = structuredClone(bundle);
      tampered.parts[0].holding.amount += 1n;
      assert.equal(verifyBundle(tampered, expected, epochRoot, epochLiabilities), false, `${username} tampered`);
    }

    // ---- the auditor pulls the reserve; the same epoch no longer clears ---
    await send(auditor, registry, registryAbi, "removeReserve", [reserve.address]);
    await assert.rejects(
      send(company, registry, registryAbi, "submitEpoch", [proof, root.hash, root.sum, roundIds]),
      /Insolvent/,
    );
  } finally {
    anvil.kill("SIGTERM");
    if (anvil.exitCode === null) await new Promise((resolve) => anvil.once("exit", resolve));
  }
});
