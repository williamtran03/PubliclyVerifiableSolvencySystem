import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createTestClient, encodeDeployData, http, keccak256, parseEther, type Abi, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { sepolia } from "viem/chains";
import { artifact } from "./chain.ts";
import { sepoliaNetwork, type Deployment } from "../sepolia/network.ts";

test("signed Sepolia journal resumes before broadcast and after mining on Anvil", { timeout: 60000 }, async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const directory = mkdtempSync(join(tmpdir(), "sepolia-recovery-"));
  const rpc = `http://127.0.0.1:${port}`;
  const env: Record<string, string> = {
    SEPOLIA_RPC_URL: rpc, DEPLOYMENT_FILE: join(directory, "sepolia.json"), PRIVATE_OUTPUT: join(directory, "bundles"),
    MAX_EPOCH_AGE: "604800", MIN_EPOCH_INTERVAL: "60",
    COMPANY_PRIVATE_KEY: generatePrivateKey(), AUDITOR_PRIVATE_KEY: generatePrivateKey(),
    LEDGER_RESERVE_PRIVATE_KEY: generatePrivateKey(), ZK_RESERVE_PRIVATE_KEY: generatePrivateKey(), KZG_RESERVE_PRIVATE_KEY: generatePrivateKey(),
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(sepolia.id), "--silent"], { stdio: "ignore" });
  let spawnError: Error | undefined;
  child.on("error", error => { spawnError = error; });
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(rpc, { retryCount: 0, timeout: 500 }) });
    for (let attempt = 0; ; attempt++) {
      if (spawnError) throw spawnError;
      try { await client.getChainId(); break; }
      catch (error) { if (attempt === 99) throw error; await delay(50); }
    }
    let network = await sepoliaNetwork();
    await createTestClient({ mode: "anvil", transport: http(rpc) }).setBalance({ address: network.company.address, value: parseEther("10") });
    const token = artifact("DemoAsset.sol", "DemoAsset");
    const data = encodeDeployData({ abi: token.abi as Abi, bytecode: token.bytecode.object as Hex, args: ["TEST", 0] });
    const signer = network.wallet(network.company);
    const prepared = await signer.prepareTransactionRequest({ data });
    const raw = await signer.signTransaction(prepared);
    const hash = keccak256(raw);
    network.record.pending = { step: "TEST", label: "deploy DemoAsset", hash, serializedTransaction: raw, sender: network.company.address, nonce: prepared.nonce };
    network.save();

    network = await sepoliaNetwork();
    await network.recover();
    assert.ok(network.record.contracts.TEST);
    assert.equal(network.record.pending, undefined);
    assert.equal(network.record.transactions.length, 1);
    await network.recover();
    assert.equal(await client.getTransactionCount({ address: network.company.address }), 1);

    const recipient = network.auditor.address;
    const transfer = await signer.prepareTransactionRequest({ to: recipient, value: 7n });
    const signed = await signer.signTransaction(transfer);
    const transferHash = keccak256(signed);
    network.record.pending = { step: "fund", label: "transfer", hash: transferHash, serializedTransaction: signed, sender: network.company.address, nonce: transfer.nonce };
    network.save();
    await client.sendRawTransaction({ serializedTransaction: signed });
    await client.waitForTransactionReceipt({ hash: transferHash });
    network = await sepoliaNetwork();
    await network.recover();
    await network.recover();
    assert.equal(await client.getBalance({ address: recipient }), 7n);
    assert.equal(network.record.transactions.length, 2);

    network.setStep("SECOND");
    const second = await network.deploy("DemoAsset.sol", "DemoAsset", ["SECOND", 0]);
    assert.equal(network.record.contracts.SECOND.toLowerCase(), second.toLowerCase());
    await network.send(network.company, second, token.abi, "mint", [recipient, 11n]);
    assert.equal(await client.readContract({ address: second, abi: token.abi, functionName: "balanceOf", args: [recipient] }), 11n);
    await network.transfer(recipient, 5n);
    assert.equal(await client.getBalance({ address: recipient }), 12n);
    const saved: Deployment = JSON.parse(readFileSync(env.DEPLOYMENT_FILE, "utf8"));
    assert.equal(saved.pending, undefined);
    assert.equal(saved.transactions.length, 5);

    const original = await signer.prepareTransactionRequest({ to: recipient, value: 2n });
    const originalRaw = await signer.signTransaction(original);
    network.record.pending = { step: "fund", label: "transfer", hash: keccak256(originalRaw), serializedTransaction: originalRaw, sender: network.company.address, nonce: original.nonce };
    network.save();
    const replacement = await signer.signTransaction({ ...original, value: 3n });
    const replacementHash = await client.sendRawTransaction({ serializedTransaction: replacement });
    await client.waitForTransactionReceipt({ hash: replacementHash });
    network = await sepoliaNetwork();
    await assert.rejects(network.recover(), /consumed/);
    assert.ok(JSON.parse(readFileSync(env.DEPLOYMENT_FILE, "utf8")).pending);
  } finally {
    if (child.exitCode === null && child.signalCode === null && !spawnError) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await exited;
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
