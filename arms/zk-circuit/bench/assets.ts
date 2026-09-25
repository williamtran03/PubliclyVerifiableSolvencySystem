import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetCount, depthOf } from "./generate.ts";
import { measure, type Form } from "./scale.ts";
import { build } from "./verifier.ts";

const RESULTS = "arms/zk-circuit/bench/assets.json";
const TABLE = "arms/zk-circuit/bench/assets.md";

type Row = {
  n: number;
  assets: number;
  form: Form;
  publicInputs: number;
  acirOpcodes?: number;
  gates?: number;
  logN?: number;
  paddedN?: number;
  proveSeconds?: number;
  provePeakRssBytes?: number | null;
  proofBytes?: number;
  verified?: boolean;
  verifyGas?: number;
  calldataBytes?: number;
  runtimeBytes?: number;
  deployable?: boolean;
  error?: string;
};

const list = (value: string | undefined, fallback: number[]) =>
  value ? value.split(",").map((s) => Number(s.trim())) : fallback;

const sizes = list(process.env.BENCH_N, [8, 1024]).filter((n) => n > 1);
const assetCounts = list(process.env.BENCH_ASSETS, [1, 2, 3, 4, 6, 8]).map(assetCount);
const form = (process.env.BENCH_FORM as Form) ?? "chained";
const timeout = Number(process.env.BENCH_TIMEOUT ?? 3600);
const scaleDir = join(tmpdir(), "solvency-bench-assets", "scale");
const verifierDir = join(tmpdir(), "solvency-bench-assets", "verifier");
const rows: Row[] = [];

const num = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-US"));
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US")}`;

function markdown(): string {
  const body = rows.map((r) => {
    const previous = rows.filter((p) => p.n === r.n && p.assets < r.assets && p.verifyGas !== undefined).at(-1);
    const first = rows.find((p) => p.n === r.n && p.verifyGas !== undefined);
    const step =
      previous && r.verifyGas !== undefined
        ? `${signed(r.verifyGas - previous.verifyGas!)} (${previous.assets}→${r.assets})`
        : "—";
    const total = first && r.verifyGas !== undefined && first !== r ? signed(r.verifyGas - first.verifyGas!) : "—";
    return (
      `| ${num(r.n)} | ${r.assets} | ${r.publicInputs} | ${num(r.gates)} | ${r.logN ?? "—"} | ` +
      `${r.proveSeconds === undefined ? "—" : `${r.proveSeconds.toFixed(2)} s`} | ` +
      `${r.provePeakRssBytes ? `${(r.provePeakRssBytes / 2 ** 20).toFixed(0)} MiB` : "—"} | ` +
      `${num(r.proofBytes)} | ${num(r.verifyGas)} | ${step} | ${total} | ${num(r.runtimeBytes)} |` +
      (r.error ? ` ${r.error.split("\n")[0].slice(0, 120)}` : "")
    );
  });
  return [
    "| N | Assets | Public inputs | Gates | `LOG_N` | `bb prove` | Peak RSS | Proof B | `verify` gas | Step | vs fewest assets | Runtime B |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...body,
    "",
  ].join("\n");
}

const save = () => {
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        platform: `${process.platform} ${process.arch}`,
        note: "Bench statement with NUM_ASSETS varied; holdings spread round-robin over the assets, every slot filled, one floor per asset as a public input. Where assets exceed N, the extra assets hold nothing and have a zero floor.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(TABLE, markdown());
};

console.log(`Sweeping assets ${assetCounts.join(", ")} at N = ${sizes.join(", ")} (${form} form)\n`);
for (const n of sizes) {
  for (const assets of assetCounts) {
    process.stdout.write(`N = ${String(n).padStart(6)} (depth ${depthOf(n)}), assets ${String(assets).padStart(2)} … `);
    const scaled = await measure(n, form, scaleDir, timeout, assets);
    const row: Row = {
      n,
      assets,
      form,
      publicInputs: assets + 2,
      acirOpcodes: scaled.acirOpcodes,
      gates: scaled.gates,
      proveSeconds: scaled.prove?.seconds,
      provePeakRssBytes: scaled.prove?.peakRssBytes,
      proofBytes: scaled.proofBytes,
      verified: scaled.verified,
    };
    if (scaled.status !== "ok") {
      row.error = `${scaled.failedStage}: ${scaled.error}`;
    } else {
      const verifier = build(n, form, verifierDir, assets);
      Object.assign(row, {
        logN: verifier.logN,
        paddedN: verifier.paddedN,
        verifyGas: verifier.verifyGas,
        calldataBytes: verifier.calldataBytes,
        runtimeBytes: verifier.runtimeBytes,
        deployable: verifier.deployable,
      });
      if (verifier.error) row.error = verifier.error;
    }
    rows.push(row);
    console.log(
      `gates ${num(row.gates)}  LOG_N ${row.logN ?? "?"}  prove ${row.proveSeconds ?? "?"}s  ` +
        `verify ${num(row.verifyGas)} gas${row.error ? `  ERROR ${row.error.slice(0, 200)}` : ""}`,
    );
    save();
  }
}
console.log(`\nWrote ${RESULTS} and ${TABLE}`);
