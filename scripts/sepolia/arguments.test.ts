import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments } from "./arguments.ts";
import { armNames } from "./network.ts";

test("defaults to all arms and preserves an explicit publication order", () => {
  assert.deepEqual(parseArguments(["epoch"]), { command: "epoch", arms: armNames });
  assert.deepEqual(parseArguments(["exercise", "snarkless", "published-ledger"]), {
    command: "exercise", arms: ["snarkless", "published-ledger"],
  });
});

test("rejects duplicate publications and silently ignored deployment selections", () => {
  for (const command of ["epoch", "exercise"]) {
    assert.throws(() => parseArguments([command, "snarkless", "snarkless"]), /only once/);
  }
  for (const command of ["deploy", "status"]) {
    assert.throws(() => parseArguments([command, "snarkless"]), /does not accept/);
  }
  assert.throws(() => parseArguments(["epoch", "typo"]), /Unknown arm/);
  assert.throws(() => parseArguments([]), /Usage/);
});
