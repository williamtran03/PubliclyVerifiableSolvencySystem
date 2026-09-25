import test from "node:test";
import assert from "node:assert/strict";
import { checkProvingTools, PROVING_VERSIONS } from "./toolchain.ts";

test("accepts the verifier toolchain and rejects missing or incompatible tools", () => {
  const version = (name: string) => PROVING_VERSIONS[name as keyof typeof PROVING_VERSIONS];
  checkProvingTools(name => `${name} version = ${version(name)}\n`);
  for (const tool of ["nargo", "bb"]) {
    assert.throws(() => checkProvingTools(name => name === tool ? "9.0.0" : version(name)), /expected .*found 9.0.0/);
    assert.throws(() => checkProvingTools(name => { if (name === tool) throw new Error("ENOENT"); return version(name); }), /required on PATH/);
  }
  assert.throws(() => checkProvingTools(() => "1.0.0-beta.260"), /expected/);
});
