import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateSrs, loadSrs, saveSrs } from "./srs.ts";

const directory = mkdtempSync(join(tmpdir(), "srs-"));
const srs = generateSrs(8);

function write(name: string, edit: (json: any) => void): string {
  const path = join(directory, name);
  saveSrs(srs, path);
  const json = JSON.parse(readFileSync(path, "utf8"));
  edit(json);
  writeFileSync(path, JSON.stringify(json));
  return path;
}

test("a saved SRS loads back as the same points", () => {
  const path = write("good.json", () => {});
  const loaded = loadSrs(path);
  assert.ok(loaded.g1.every((point, i) => point.equals(srs.g1[i])));
  assert.ok(loaded.tauG2.equals(srs.tauG2));
  assert.ok(loaded.boundG2.equals(srs.boundG2));
});

test("a point that is not on the curve is refused", () => {
  const path = write("off-curve.json", (json) => (json.g1[3] = ["0x1", "0x1"]));
  assert.throws(() => loadSrs(path), /invalid point|not valid|Point/i, "an off-curve point would make every opening meaningless");
});

test("points that do not share one tau are refused", () => {
  const path = write("wrong-power.json", (json) => (json.g1[2] = json.g1[1]));
  assert.throws(() => loadSrs(path), /not successive powers of one tau/);
});

test("a degree bound outside the SRS is refused", () => {
  const path = write("bad-bound.json", (json) => (json.boundedDegree = json.maxDegree + 1));
  assert.throws(() => loadSrs(path), /bounds degree/);
});

test("a truncated SRS is refused", () => {
  const path = write("short.json", (json) => (json.g1 = json.g1.slice(0, 5)));
  assert.throws(() => loadSrs(path), /needs 9/, "a short SRS would silently cap the degree the verifier believes it bounds");
});
