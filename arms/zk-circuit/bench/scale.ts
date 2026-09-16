import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, encodePacked, type Hex } from "viem";
import { mainNr, mainNrFlat, NARGO_TOML, benchHoldings, proverToml, depthOf } from "./generate.ts";

const SEED = keccak256(encodePacked(["string"], ["solvency bench seed"])) as Hex;
const CONTEXT = 7n;
const RESULTS = "arms/zk-circuit/bench/results.json";
const TABLE = "arms/zk-circuit/bench/results.md";
const DEFAULT_N = [8, 32, 128, 512, 2048, 8192, 32768];

type Form = "chained" | "flat";
type Stage = { seconds: number; peakRssBytes: number | null };
type Row = {
  n: number;
  depth: number;
  form: Form;
  status: "ok" | "failed";
  acirOpcodes?: number;
  gates?: number;
  execute?: Stage;
  writeVk?: Stage;
  prove?: Stage;
  verified?: boolean;
  proofBytes?: number;
  vkBytes?: number;
  failedStage?: string;
  error?: string;
};

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
): Promise<{ ok: boolean; seconds: number; peakRssBytes: number | null; output: string }> {
  const timed = process.platform === "darwin" || process.platform === "linux";
  const [bin, binArgs] = timed
    ? ["/usr/bin/time", [process.platform === "darwin" ? "-l" : "-v", cmd, ...args]]
    : [cmd, args];

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, binArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));

    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutSeconds * 1000);
    child.on("close", (code) => {
      clearTimeout(killer);
      const match = output.match(/(\d+)\s+maximum resident set size/);
      resolve({
        ok: code === 0,
        seconds: (Date.now() - started) / 1000,
        peakRssBytes: match ? Number(match[1]) * (process.platform === "darwin" ? 1 : 1024) : null,
        output,
      });
    });
  });
}

function writeProject(dir: string, n: number, form: Form): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Nargo.toml"), NARGO_TOML);
  writeFileSync(join(dir, "src", "main.nr"), (form === "flat" ? mainNrFlat : mainNr)(n));
  writeFileSync(join(dir, "Prover.toml"), proverToml(benchHoldings(n, SEED), CONTEXT));
}

const diagnostic = (output: string) =>
  output.replace(/^\s+\d+(\.\d+)?\s+(real|user|sys|[a-z].*)$/gm, "").replace(/\n{2,}/g, "\n").trim().slice(-900);

const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
const stage = (r: { seconds: number; peakRssBytes: number | null }): Stage => ({
  seconds: Number(r.seconds.toFixed(2)),
  peakRssBytes: r.peakRssBytes,
});
const gib = (bytes: number | null) => (bytes === null ? "n/a" : `${(bytes / 2 ** 30).toFixed(2)} GiB`);
const secs = (s: Stage | undefined) => (s ? `${s.seconds.toFixed(2)} s` : "—");

function markdown(rows: Row[]): string {
  const body = rows.map((r) =>
    r.status === "ok"
      ? `| ${r.form} | ${r.n.toLocaleString()} | ${r.depth} | ${r.gates?.toLocaleString() ?? "?"} | ` +
        `${secs(r.execute)} | ${secs(r.writeVk)} | ${secs(r.prove)} | ${gib(r.prove!.peakRssBytes)} | ` +
        `${r.proofBytes?.toLocaleString()} B |`
      : `| ${r.form} | ${r.n.toLocaleString()} | ${r.depth} | **fails at \`${r.failedStage}\`** | | | | | |`,
  );
  return [
    "| Form | N | Depth | Gates | `nargo execute` | `bb write_vk` | `bb prove` | Peak RSS (prove) | Proof |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...body,
    "",
  ].join("\n");
}

async function measure(n: number, form: Form, dir: string, timeout: number): Promise<Row> {
  const depth = depthOf(n);
  const row: Row = { n, depth, form, status: "failed" };
  writeProject(dir, n, form);

  const info = await run("nargo", ["info"], dir, timeout);
  row.acirOpcodes = Number(info.output.match(/\|\s*main\s*\|\s*(\d+)\s*\|/)?.[1] ?? NaN) || undefined;

  const execute = await run("nargo", ["execute"], dir, timeout);
  row.execute = stage(execute);
  if (!execute.ok) return { ...row, failedStage: "nargo execute", error: diagnostic(execute.output) };

  const bytecode = join(dir, "target", "circuit_bench.json");
  const gates = await run("bb", ["gates", "-b", bytecode, "-t", "evm"], dir, timeout);
  row.gates = Number(gates.output.match(/"circuit_size"\s*:\s*(\d+)/)?.[1] ?? NaN) || undefined;

  const vk = await run(
    "bb",
    ["write_vk", "-s", "ultra_honk", "-b", bytecode, "-o", "target/vk", "--oracle_hash", "keccak"],
    dir,
    timeout,
  );
  row.writeVk = stage(vk);
  if (!vk.ok) return { ...row, failedStage: "bb write_vk", error: diagnostic(vk.output) };

  const prove = await run(
    "bb",
    ["prove", "-s", "ultra_honk", "-b", bytecode, "-w", "target/circuit_bench.gz",
     "-o", "target/proof", "-k", "target/vk/vk", "--oracle_hash", "keccak"],
    dir,
    timeout,
  );
  row.prove = stage(prove);
  if (!prove.ok) return { ...row, failedStage: "bb prove", error: diagnostic(prove.output) };

  const verify = await run(
    "bb",
    ["verify", "-s", "ultra_honk", "-p", "target/proof/proof", "-k", "target/vk/vk",
     "-i", "target/proof/public_inputs", "--oracle_hash", "keccak"],
    dir,
    timeout,
  );

  return {
    ...row,
    status: "ok",
    verified: verify.ok,
    proofBytes: size(join(dir, "target", "proof", "proof")),
    vkBytes: size(join(dir, "target", "vk", "vk")),
  };
}

const sizes = (process.env.BENCH_N?.split(",").map((s) => Number(s.trim())) ?? DEFAULT_N).filter((n) => n > 1);
const forms = (process.env.BENCH_FORM?.split(",") ?? ["chained", "flat"]) as Form[];
const timeout = Number(process.env.BENCH_TIMEOUT ?? 3600);
const dir = join(tmpdir(), "solvency-bench");
const rows: Row[] = [];

const save = () => {
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        platform: `${process.platform} ${process.arch}`,
        note: "One leaf per (customer, asset) holding; every slot filled.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(TABLE, markdown(rows));
};

console.log(`Sweeping N = ${sizes.join(", ")} in ${forms.join(" and ")} form (per-stage timeout ${timeout}s)\n`);

for (const form of forms) {
  console.log(`--- ${form} ---`);
  for (const n of sizes) {
    process.stdout.write(`N = ${String(n).padStart(6)} (depth ${depthOf(n)}) … `);
    const row = await measure(n, form, dir, timeout);
    rows.push(row);

    if (row.status === "ok") {
      console.log(
        `gates ${row.gates?.toLocaleString() ?? "?"}  ` +
          `execute ${row.execute!.seconds}s  vk ${row.writeVk!.seconds}s  ` +
          `prove ${row.prove!.seconds}s  peak ${gib(row.prove!.peakRssBytes)}  ` +
          `proof ${row.proofBytes}B${row.verified ? "" : "  PROOF DID NOT VERIFY"}`,
      );
    } else {
      console.log(`FAILED at ${row.failedStage}`);
      console.log(row.error?.split("\n").slice(0, 6).map((l) => `    ${l}`).join("\n"));
    }

    save();
    if (row.status === "failed") {
      console.log(`  ↳ stopping the ${form} sweep: larger N cannot succeed where ${n} did not.\n`);
      break;
    }
  }
}

console.log(`\nWrote ${RESULTS} and ${TABLE}`);
