import { bn254 } from "@noble/curves/bn254";
import { G1, G2, isPowersOfTau, type Srs } from "./srs.ts";

const { Fp } = bn254.fields;
const R_INVERSE = Fp.inv(Fp.create(1n << 256n));
const G1_BYTES = 64;
const G2_BYTES = 128;

function little(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

const coordinate = (bytes: Uint8Array) => Fp.mul(little(bytes), R_INVERSE);

function sections(file: Uint8Array): Map<number, Uint8Array> {
  if (new TextDecoder().decode(file.subarray(0, 4)) !== "ptau") throw new Error("not a ptau file");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const found = new Map<number, Uint8Array>();
  let offset = 12;
  for (let i = 0; i < view.getUint32(8, true); i++) {
    const type = view.getUint32(offset, true);
    const size = Number(view.getBigUint64(offset + 4, true));
    found.set(type, file.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  return found;
}

export function srsFromPtau(file: Uint8Array, maxDegree: number, boundedDegree: number): Srs {
  const parts = sections(file);
  const header = parts.get(1);
  const tauG1 = parts.get(2);
  const tauG2 = parts.get(3);
  if (!header || !tauG1 || !tauG2) throw new Error("the ptau file lacks the header or the tau sections");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== 32 || little(header.subarray(4, 36)) !== Fp.ORDER) {
    throw new Error("the ceremony is not over BN254");
  }
  const shift = maxDegree - boundedDegree;
  if (tauG1.length < (maxDegree + 1) * G1_BYTES || tauG2.length < (shift + 1) * G2_BYTES) {
    throw new Error("the ceremony has fewer powers than the SRS needs");
  }

  const g1At = (i: number) => {
    const bytes = tauG1.subarray(i * G1_BYTES, (i + 1) * G1_BYTES);
    const point = G1.fromAffine({ x: coordinate(bytes.subarray(0, 32)), y: coordinate(bytes.subarray(32, 64)) });
    point.assertValidity();
    return point;
  };
  const g2At = (i: number) => {
    const bytes = tauG2.subarray(i * G2_BYTES, (i + 1) * G2_BYTES);
    const point = G2.fromAffine({
      x: { c0: coordinate(bytes.subarray(0, 32)), c1: coordinate(bytes.subarray(32, 64)) },
      y: { c0: coordinate(bytes.subarray(64, 96)), c1: coordinate(bytes.subarray(96, 128)) },
    });
    point.assertValidity();
    return point;
  };

  const srs: Srs = {
    maxDegree,
    g1: Array.from({ length: maxDegree + 1 }, (_, i) => g1At(i)),
    g2: g2At(0),
    tauG2: g2At(1),
    boundedDegree,
    boundG2: g2At(shift),
  };
  if (!isPowersOfTau(srs)) throw new Error("the ceremony points are not successive powers of one tau");
  return srs;
}
