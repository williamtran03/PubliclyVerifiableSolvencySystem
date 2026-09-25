import { test } from "node:test";
import assert from "node:assert/strict";
import { bn254 } from "@noble/curves/bn254";
import { generateSrs, isPowersOfTau, G1, G2, type G1Point, type G2Point, type Srs } from "./srs.ts";
import { srsFromPtau } from "./ceremony.ts";

const { Fp } = bn254.fields;
const R = Fp.create(1n << 256n);

const bytes = (value: bigint) => Array.from({ length: 32 }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));
const little = (value: bigint) => bytes(Fp.mul(value, R));

function section(type: number, body: number[]): number[] {
  const head = new DataView(new ArrayBuffer(12));
  head.setUint32(0, type, true);
  head.setBigUint64(4, BigInt(body.length), true);
  return [...new Uint8Array(head.buffer), ...body];
}

function ptau(srs: Srs, g1: G1Point[] = srs.g1): Uint8Array {
  const shift = srs.maxDegree - srs.boundedDegree;
  const g2: G2Point[] = Array.from({ length: shift + 1 }, (_, i) =>
    i === 0 ? srs.g2 : i === 1 ? srs.tauG2 : i === shift ? srs.boundG2 : G2.BASE,
  );
  const word = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
  const header = [...word(32), ...bytes(Fp.ORDER), ...word(6), ...word(6)];
  const g1Bytes = g1.flatMap((p) => { const a = p.toAffine(); return [...little(a.x), ...little(a.y)]; });
  const g2Bytes = g2.flatMap((p) => { const a = p.toAffine(); return [...little(a.x.c0), ...little(a.x.c1), ...little(a.y.c0), ...little(a.y.c1)]; });
  return new Uint8Array([...new TextEncoder().encode("ptau"), ...word(1), ...word(3), ...section(1, header), ...section(2, g1Bytes), ...section(3, g2Bytes)]);
}

test("a ptau transcript round-trips into the SRS the registry needs", () => {
  const srs = generateSrs(32);
  const parsed = srsFromPtau(ptau(srs), 32, 7);
  assert.ok(parsed.g1.every((p, i) => p.equals(srs.g1[i])));
  assert.ok(parsed.tauG2.equals(srs.tauG2));
  assert.ok(parsed.boundG2.equals(srs.boundG2));
  assert.ok(isPowersOfTau(parsed));
});

test("a transcript whose powers do not share one tau is refused", () => {
  const srs = generateSrs(32);
  const tampered = srs.g1.map((p, i) => (i === 5 ? p.add(G1.BASE) : p));
  assert.throws(() => srsFromPtau(ptau(srs, tampered), 32, 7), /not successive powers/);
  assert.equal(isPowersOfTau({ ...srs, boundG2: srs.tauG2 }), false);
});

test("a transcript with too few powers is refused", () => {
  const srs = generateSrs(32);
  assert.throws(() => srsFromPtau(ptau(srs, srs.g1.slice(0, 20)), 32, 7), /fewer powers/);
});
