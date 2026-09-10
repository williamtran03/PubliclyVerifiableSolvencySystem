import { test } from "node:test";
import assert from "node:assert/strict";
import { MockOracle, convert, toUsd, manifestHash, type Rate } from "./oracle.ts";
import { MAX } from "./tree.ts";
const rate: Rate = {
  token: "0x0000000000000000000000000000000000000001",
  feed: "0x0000000000000000000000000000000000000002",
  tokenDecimals: 18,
  oracleDecimals: 8,
  rate: 2000n * 10n ** 8n,
  roundId: 1n,
  updatedAt: 1000n,
};
const snap = `0x${"01".repeat(32)}` as const;
test("oracle conversion preserves provenance and normalizes decimals with integers", async () => {
  const c = await convert(new MockOracle([rate]), rate.token, 10n ** 18n, 1010n, 60n);
  assert.equal(c.usd, 2000n * 10n ** 8n);
  assert.equal(c.rawAmount, 10n ** 18n);
  assert.equal(c.roundId, 1n);
  assert.equal(
    toUsd(
      1000000n,
      { ...rate, tokenDecimals: 6, oracleDecimals: 18, rate: 10n ** 18n },
      1010n,
      60n,
    ),
    10n ** 8n,
  );
});
test("liabilities round up, assets round down", () => {
  assert.equal(toUsd(1n, rate, 1000n, 60n), 1n);
  assert.equal(toUsd(1n, rate, 1000n, 60n, "down"), 0n);
});
for (const [name, patch] of Object.entries({
  zero: { rate: 0n },
  negative: { rate: -1n },
  stale: { updatedAt: 1n },
  future: { updatedAt: 1001n },
  "missing round": { roundId: 0n },
  "wide round": { roundId: 1n << 80n },
  "negative decimals": { tokenDecimals: -1 },
  "large decimals": { oracleDecimals: 19 },
  "fractional decimals": { tokenDecimals: 1.5 },
  "invalid feed": { feed: "0x0" },
}))
  test(`reject oracle ${name}`, () =>
    assert.throws(() => toUsd(1n, { ...rate, ...patch } as Rate, 1000n, 60n)));
test("reject unsupported assets and overflow", async () => {
  await assert.rejects(() => convert(new MockOracle([]), rate.token, 1n, 1000n, 60n));
  assert.throws(() => toUsd(MAX, rate, 1000n, 60n));
  assert.throws(() => toUsd(-1n, rate, 1000n, 60n));
});
test("canonical manifest binds snapshot, rates, decimals, rounds and times", () => {
  const h = manifestHash(snap, [rate], 1000n, 60n);
  assert.equal(h, manifestHash(snap, [{ ...rate }], 1000n, 60n));
  for (const patch of [{ rate: 1n }, { roundId: 2n }, { updatedAt: 999n }, { tokenDecimals: 6 }])
    assert.notEqual(h, manifestHash(snap, [{ ...rate, ...patch }], 1000n, 60n));
  assert.throws(() => manifestHash(snap, [rate, rate], 1000n, 60n));
  assert.throws(() => manifestHash(snap, [], 1000n, 60n));
});
