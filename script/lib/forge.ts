import { readFileSync } from "node:fs";
import type { Abi, Hex } from "viem";

/**
 * Reads a compiled contract out of Foundry's `out/` directory.
 *
 * Deploying from TypeScript rather than `forge create` keeps the whole demo in
 * one process, so it can assert on results instead of printing them for a human
 * to eyeball.
 */
export function readArtifact(
  source: string,
  contract: string = source,
): { abi: Abi; bytecode: Hex } {
  const artifact = JSON.parse(readFileSync(`out/${source}.sol/${contract}.json`, "utf8"));
  const bytecode = artifact.bytecode?.object as Hex | undefined;
  if (!bytecode || bytecode === "0x") {
    throw new Error(`out/${source}.sol/${contract}.json has no bytecode — run \`forge build\``);
  }
  return { abi: artifact.abi as Abi, bytecode };
}
