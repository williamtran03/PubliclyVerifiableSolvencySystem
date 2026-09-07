import { readFileSync } from "node:fs";
import type { Abi, Hex } from "viem";

export type LinkReferences = Record<string, Record<string, { start: number; length: number }[]>>;

export type Artifact = {
  abi: Abi;
  bytecode: Hex;
  linkReferences: LinkReferences;
};

/**
 * Reads a compiled contract out of Foundry's `out/` directory.
 *
 * Deploying from TypeScript rather than `forge create` keeps the whole demo in
 * one process, so it can assert on results instead of printing them for a human
 * to eyeball.
 */
export function readArtifact(source: string, contract: string = source): Artifact {
  const artifact = JSON.parse(readFileSync(`out/${source}.sol/${contract}.json`, "utf8"));
  const bytecode = artifact.bytecode?.object as Hex | undefined;
  if (!bytecode || bytecode === "0x") {
    throw new Error(`out/${source}.sol/${contract}.json has no bytecode — run \`forge build\``);
  }
  return {
    abi: artifact.abi as Abi,
    bytecode,
    linkReferences: (artifact.bytecode?.linkReferences ?? {}) as LinkReferences,
  };
}

export function libraryNames(artifact: Artifact): string[] {
  return Object.values(artifact.linkReferences).flatMap((byName) => Object.keys(byName));
}

/**
 * Substitutes deployed library addresses into a contract's bytecode.
 *
 * `bb write_solidity_verifier` splits the verifier across external libraries,
 * so its bytecode ships with `__$...$__` placeholders that have to be filled in
 * before deployment. `forge script` does this silently; doing it here keeps the
 * demo a single process, and makes the step visible rather than magic.
 */
export function linkBytecode(artifact: Artifact, addresses: Record<string, Hex>): Hex {
  let bytecode = artifact.bytecode.slice(2);

  for (const byName of Object.values(artifact.linkReferences)) {
    for (const [name, spots] of Object.entries(byName)) {
      const address = addresses[name];
      if (!address) throw new Error(`no deployed address for library ${name}`);

      for (const { start, length } of spots) {
        // Offsets are in bytes; the string holds two hex characters per byte.
        const from = start * 2;
        bytecode =
          bytecode.slice(0, from) + address.slice(2).toLowerCase() + bytecode.slice(from + length * 2);
      }
    }
  }

  if (bytecode.includes("__$")) throw new Error("bytecode still has unlinked placeholders");
  return `0x${bytecode}`;
}
