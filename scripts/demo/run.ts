import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { runLedgerDemo } from "../../arms/published-ledger/script/demo.ts";
import { runZkDemo } from "../../arms/zk-circuit/script/demo.ts";
import { runKzgDemo } from "../../arms/snarkless/script/demo.ts";
import { isMain, outputDirectory, writeJson } from "./chain.ts";

async function availablePort(port: number) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port number.");
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const chosen = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return chosen;
}

export async function startDemo(options: { ports?: number[]; webPort?: number; withWeb?: boolean } = {}) {
  const output = outputDirectory();
  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      try { await exited; } finally { clearTimeout(timer); }
    }));
  };
  const handleSignal = () => { void stop().then(() => process.exit(0)); };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  const launch = (command: string, args: string[], name: string, env = process.env) => {
    const log = openSync(join(output, `${name}.log`), "w", 0o600);
    const child = spawn(command, args, { env, stdio: ["ignore", log, log] });
    closeSync(log);
    children.push(child);
    let error: Error | undefined;
    child.on("error", cause => { error = cause; });
    return { child, check() { if (error) throw error; if (child.exitCode !== null) throw new Error(`${name} exited; see ${join(output, `${name}.log`)}`); } };
  };
  try {
    const requested = options.ports ?? [8545, 8546, 8547];
    if (requested.length !== 3) throw new Error("Exactly three RPC ports are required.");
    const ports: number[] = [];
    for (const port of requested) ports.push(await availablePort(port));
    if (new Set(ports).size !== 3) throw new Error("RPC ports must be distinct.");
    const webPort = options.withWeb === false ? undefined : await availablePort(options.webPort ?? 5175);
    if (webPort && ports.includes(webPort)) throw new Error("Web and RPC ports must differ.");
    const ids = [31338, 31337, 31339]; // ZK fixtures are bound to 31337.
    const rpcs = ports.map(port => `http://127.0.0.1:${port}`);
    for (const [index, port] of ports.entries()) {
      const process = launch("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(ids[index]), "--silent"], `anvil-${port}`);
      const client = createPublicClient({ transport: http(rpcs[index], { retryCount: 0, timeout: 500 }) });
      for (let attempt = 0; ; attempt++) {
        process.check();
        try { if (await client.getChainId() !== ids[index]) throw new Error("Wrong chain ID"); break; }
        catch (error) { if (attempt === 99) throw error; await delay(100); }
      }
    }
    const connections = {
      "published-ledger": await runLedgerDemo(rpcs[0], output),
      "zk-circuit": await runZkDemo(rpcs[1], output),
      snarkless: await runKzgDemo(rpcs[2], output),
    };
    writeJson(output, "connections.json", { version: 1, solutions: connections });
    if (webPort) {
      const web = launch(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.opensolvency.config.ts", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], "web", { ...process.env, OPENSOLVENCY_DEMO_CONFIG: join(output, "connections.json") });
      for (let attempt = 0; ; attempt++) {
        web.check();
        try { const response = await fetch(`http://127.0.0.1:${webPort}/demo-config.json`, { signal: AbortSignal.timeout(1000) }); if (!response.ok) throw new Error("Web server not ready"); break; }
        catch (error) { if (attempt === 99) throw error; await delay(100); }
      }
    }
    console.table(connections);
    console.log(`Private demo artifacts: ${output}`);
    if (webPort) console.log(`Open http://localhost:${webPort}/ and select Use local demo. Ctrl+C stops only the processes started by this command.`);
    return { connections, output, webPort, stop };
  } catch (error) { await stop(); throw error; }
}

if (isMain(import.meta.url)) {
  execFileSync("forge", ["build"], { stdio: "inherit" });
  const base = Number(process.env.DEMO_BASE_PORT ?? 8545);
  await startDemo({ ports: [base, base + 1, base + 2], webPort: Number(process.env.DEMO_WEB_PORT ?? 5175) });
}
