import { Fr } from "./field.ts";

export type Poly = bigint[];

export function trim(poly: Poly): Poly {
  let end = poly.length;
  while (end > 1 && Fr.is0(poly[end - 1])) end--;
  return poly.slice(0, end);
}

export function add(a: Poly, b: Poly): Poly {
  const out: Poly = new Array(Math.max(a.length, b.length)).fill(Fr.ZERO);
  for (let i = 0; i < out.length; i++) {
    out[i] = Fr.add(a[i] ?? Fr.ZERO, b[i] ?? Fr.ZERO);
  }
  return out;
}

export function sub(a: Poly, b: Poly): Poly {
  const out: Poly = new Array(Math.max(a.length, b.length)).fill(Fr.ZERO);
  for (let i = 0; i < out.length; i++) {
    out[i] = Fr.sub(a[i] ?? Fr.ZERO, b[i] ?? Fr.ZERO);
  }
  return out;
}

export function scale(poly: Poly, factor: bigint): Poly {
  return poly.map((coefficient) => Fr.mul(coefficient, factor));
}

export function mul(a: Poly, b: Poly): Poly {
  const out: Poly = new Array(a.length + b.length - 1).fill(Fr.ZERO);
  for (let i = 0; i < a.length; i++) {
    if (Fr.is0(a[i])) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] = Fr.add(out[i + j], Fr.mul(a[i], b[j]));
    }
  }
  return out;
}

export function evaluate(poly: Poly, x: bigint): bigint {
  let result = Fr.ZERO;
  for (let i = poly.length - 1; i >= 0; i--) {
    result = Fr.add(Fr.mul(result, x), poly[i]);
  }
  return result;
}

export function divideByLinear(poly: Poly, z: bigint): Poly {
  const n = poly.length;
  if (n === 0) return [Fr.ZERO];

  const quotient: Poly = new Array(Math.max(n - 1, 1)).fill(Fr.ZERO);
  let carry = Fr.ZERO;
  for (let i = n - 1; i > 0; i--) {
    carry = Fr.add(poly[i], Fr.mul(carry, z));
    quotient[i - 1] = carry;
  }
  return quotient;
}

export function divideByVanishing(poly: Poly, n: number): Poly {
  const remainder = [...poly];
  const quotient: Poly = new Array(Math.max(poly.length - n, 1)).fill(Fr.ZERO);

  for (let i = remainder.length - 1; i >= n; i--) {
    const coefficient = remainder[i];
    if (Fr.is0(coefficient)) continue;
    quotient[i - n] = Fr.add(quotient[i - n], coefficient);
    remainder[i] = Fr.ZERO;
    remainder[i - n] = Fr.add(remainder[i - n], coefficient);
  }

  for (let i = 0; i < Math.min(n, remainder.length); i++) {
    if (!Fr.is0(remainder[i])) {
      throw new Error("polynomial is not divisible by X^n - 1: the identity does not hold on H");
    }
  }
  return quotient;
}

export function evaluateVanishing(z: bigint, n: number): bigint {
  return Fr.sub(Fr.pow(z, BigInt(n)), Fr.ONE);
}
