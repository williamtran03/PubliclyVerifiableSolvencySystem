import { execFileSync } from "node:child_process";

// These versions produced the committed verifier. Updating them requires
// regenerating the verifier and running the real-proof integration suite.
export const PROVING_VERSIONS = { nargo: "1.0.0-beta.26", bb: "6.0.0-nightly.20260902" } as const;

export function checkProvingTools(versionOf = (tool: string) =>
  execFileSync(tool, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) {
  for (const [tool, expected] of Object.entries(PROVING_VERSIONS)) {
    let output: string;
    try { output = versionOf(tool); }
    catch { throw new Error(`${tool} ${expected} is required on PATH to generate proofs.`); }
    const actual = output.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0];
    if (actual !== expected) throw new Error(`${tool}: expected ${expected}, found ${actual ?? "an unrecognised version"}. Use the toolchain for the committed verifier.`);
  }
}
