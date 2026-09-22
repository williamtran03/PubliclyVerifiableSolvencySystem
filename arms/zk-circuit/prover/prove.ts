import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toHex, type Hex } from "viem";

const CIRCUIT = "arms/zk-circuit/circuit";

export function prove(proverToml: string, workDir: string): Hex {
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
