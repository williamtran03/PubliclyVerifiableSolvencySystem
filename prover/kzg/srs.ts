import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { bn254 } from "@noble/curves/bn254";
import { Fr } from "./field.ts";

const G1 = bn254.G1.ProjectivePoint;
const G2 = bn254.G2.ProjectivePoint;

export type G1Point = InstanceType<typeof G1>;
export type G2Point = InstanceType<typeof G2>;

/**
 * A KZG structured reference string: `[tau^i]_1` for i up to `maxDegree`, plus
 * `[1]_2` and `[tau]_2`.
 *
 * Whoever knows `tau` can forge an opening for any value, which is why real
 * deployments take these points from a multi-party ceremony (perpetual powers
 * of tau, Aztec Ignition) where at least one participant is assumed to have
 * discarded their share. `generateSrs` below does NOT do that — see its note.
 */
export type Srs = {
  maxDegree: number;
  g1: G1Point[];
  g2: G2Point;
  tauG2: G2Point;
};

/**
 * Generates an SRS locally, from a tau this process makes up and then forgets.
 *
 * This is a development convenience and a real weakness: the tau exists in this
 * process's memory for the length of one function call, and nothing proves it
 * was not written down. A production deployment must load ceremony output via
 * `loadSrs` instead. The docs say so too, because a reader who only skims the
 * code should still not come away believing this is a trusted setup.
 */
export function generateSrs(maxDegree: number): Srs {
  const tau = Fr.create(BigInt(`0x${randomBytes(64).toString("hex")}`));
  if (Fr.is0(tau)) throw new Error("degenerate tau; retry");

  const g1: G1Point[] = new Array(maxDegree + 1);
  let power = Fr.ONE;
  for (let i = 0; i <= maxDegree; i++) {
    g1[i] = G1.BASE.multiply(power);
    power = Fr.mul(power, tau);
  }

  return { maxDegree, g1, g2: G2.BASE, tauG2: G2.BASE.multiply(tau) };
}

type SerializedSrs = {
  maxDegree: number;
  g1: [string, string][];
  g2: [string, string, string, string];
  tauG2: [string, string, string, string];
};

const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function g1ToJson(point: G1Point): [string, string] {
  const affine = point.toAffine();
  return [hex(affine.x), hex(affine.y)];
}

function g2ToJson(point: G2Point): [string, string, string, string] {
  const affine = point.toAffine();
  return [hex(affine.x.c0), hex(affine.x.c1), hex(affine.y.c0), hex(affine.y.c1)];
}

export function saveSrs(srs: Srs, path: string): void {
  const json: SerializedSrs = {
    maxDegree: srs.maxDegree,
    g1: srs.g1.map(g1ToJson),
    g2: g2ToJson(srs.g2),
    tauG2: g2ToJson(srs.tauG2),
  };
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

export function loadSrs(path: string): Srs {
  const json = JSON.parse(readFileSync(path, "utf8")) as SerializedSrs;
  const g2 = (values: [string, string, string, string]) =>
    G2.fromAffine({
      x: { c0: BigInt(values[0]), c1: BigInt(values[1]) },
      y: { c0: BigInt(values[2]), c1: BigInt(values[3]) },
    });

  return {
    maxDegree: json.maxDegree,
    g1: json.g1.map(([x, y]) => G1.fromAffine({ x: BigInt(x), y: BigInt(y) })),
    g2: g2(json.g2),
    tauG2: g2(json.tauG2),
  };
}

/**
 * The four coordinates of a G2 point in the order the EVM's pairing precompile
 * wants them: imaginary part first.
 */
export function g2ForPrecompile(point: G2Point): [bigint, bigint, bigint, bigint] {
  const affine = point.toAffine();
  return [affine.x.c1, affine.x.c0, affine.y.c1, affine.y.c0];
}

export { G1, G2 };
