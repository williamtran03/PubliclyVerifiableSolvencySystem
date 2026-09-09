import { keccak256 } from "viem";
import { Fr } from "./field.ts";
import { G1, type G1Point } from "./srs.ts";

export class Transcript {
  private state: `0x${string}`;

  constructor(label: string) {
    this.state = keccak256(new TextEncoder().encode(label));
  }

  private absorbBytes(bytes: Uint8Array): void {
    const combined = new Uint8Array(32 + bytes.length);
    combined.set(hexToBytes(this.state), 0);
    combined.set(bytes, 32);
    this.state = keccak256(combined);
  }

  absorbScalar(value: bigint): void {
    this.absorbBytes(toBytes32(Fr.create(value)));
  }

  absorbPoint(point: G1Point): void {
    const bytes = new Uint8Array(64); // EVM encodes infinity as (0, 0)
    if (!point.equals(G1.ZERO)) {
      const affine = point.toAffine();
      bytes.set(toBytes32(affine.x), 0);
      bytes.set(toBytes32(affine.y), 32);
    }
    this.absorbBytes(bytes);
  }

  challenge(): bigint {
    this.absorbBytes(new Uint8Array([0x01]));
    return Fr.create(BigInt(this.state));
  }
}

function toBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}
