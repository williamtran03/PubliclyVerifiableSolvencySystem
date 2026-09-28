import test from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { benchHoldings, mainNr, mainNrFlat, proverToml } from "./generate.ts";

test("benchmark circuits bind customer secret commitments like the production circuit", () => {
  const holdings = benchHoldings(4, `0x${"11".repeat(32)}` as Hex);
  const prover = proverToml(holdings, 7n);

  assert.match(prover, /secret_commitments = \[/);
  assert.doesNotMatch(prover, /\bsalts\s*=/);
  for (const source of [mainNr(4), mainNrFlat(4)]) {
    assert.match(source, /secret_commitments: \[Field; CAPACITY\]/);
    assert.match(source, /\[usernames\[i\], secret_commitments\[i\], asset_ids\[i\] as Field, amounts\[i\] as Field\]/);
    assert.doesNotMatch(source, /\bsalts\b/);
  }
  for (const holding of holdings) {
    assert.ok(holding.secretCommitment > 0n);
    assert.ok(holding.secretCommitment < 21888242871839275222246405745257275088548364400416034343698204186575808495617n);
    assert.ok(prover.includes(`"${holding.secretCommitment}"`));
  }
});
