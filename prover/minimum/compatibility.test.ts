import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { identity, balance, pairNode, combine, tree } from "./tree.ts";
import { manifestHash } from "./oracle.ts";
test("TypeScript matches the checked-in Solidity fixture including ABI widths, domains and padding", () => {
  const f = JSON.parse(readFileSync("fixtures/minimum-hashes.json", "utf8"));
  const id = identity(f.snapshot, "synthetic-fixture", "2000-01-01", 0, f.salt, f.nonce);
  assert.equal(id, f.identity);
  const amount = BigInt(f.amount),
    second = BigInt(f.secondAmount);
  const pairs = [
    { identity: id, amount },
    { identity: f.secondIdentity, amount: second },
  ];
  assert.equal(balance(f.snapshot, 0, amount).hash, f.leaf);
  assert.equal(pairNode(f.snapshot, 0, pairs[0]).hash, f.pair);
  assert.equal(
    combine(pairNode(f.snapshot, 0, pairs[0]), pairNode(f.snapshot, 1, pairs[1])).hash,
    f.parent,
  );
  const root = tree(f.snapshot, 4, pairs).root;
  assert.equal(root.hash, f.root);
  assert.equal(root.sum, BigInt(f.rootSum));
  assert.equal(
    manifestHash(
      f.snapshot,
      [
        {
          token: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          feed: "0x0000000000000000000000000000000000000010",
          tokenDecimals: 18,
          oracleDecimals: 8,
          rate: 200000000000n,
          roundId: 1n,
          updatedAt: 990n,
        },
      ],
      1000n,
      60n,
    ),
    f.rateManifestHash,
  );
});
