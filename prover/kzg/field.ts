import { bn254 } from "@noble/curves/bn254";

/** BN254's scalar field — the field the EVM's pairing precompiles work over. */
export const Fr = bn254.fields.Fr;
export const FR_ORDER = Fr.ORDER;

/**
 * A multiplicative generator of Fr*. 5 is the standard choice for BN254 and is
 * checked in the tests rather than taken on faith.
 */
const GENERATOR = 5n;

/** Fr* has a 2^28-element subgroup, so domains up to 2^28 exist. */
export const MAX_DOMAIN_LOG = 28;

/**
 * A primitive n-th root of unity, for n a power of two.
 *
 * Interpolating balances over the powers of this root is what makes the grand
 * sum cheap: the sum of a polynomial's evaluations over all n-th roots of unity
 * collapses to n times its constant coefficient, because every other power of
 * omega sums to zero around the circle.
 */
export function nthRootOfUnity(n: number): bigint {
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`domain size ${n} is not a power of two`);
  if (Math.log2(n) > MAX_DOMAIN_LOG) throw new Error(`domain size ${n} exceeds 2^${MAX_DOMAIN_LOG}`);

  const omega = Fr.pow(GENERATOR, (FR_ORDER - 1n) / BigInt(n));
  if (n > 1 && Fr.eql(Fr.pow(omega, BigInt(n / 2)), Fr.ONE)) {
    throw new Error("computed root of unity is not primitive");
  }
  return omega;
}

/** `[1, omega, omega^2, ...]` — the evaluation domain H. */
export function domain(n: number): bigint[] {
  const omega = nthRootOfUnity(n);
  const points: bigint[] = new Array(n);
  let current = Fr.ONE;
  for (let i = 0; i < n; i++) {
    points[i] = current;
    current = Fr.mul(current, omega);
  }
  return points;
}

/** Radix-2 FFT over Fr, in place on a copy. `inverse` divides by n at the end. */
export function fft(values: bigint[], inverse = false): bigint[] {
  const n = values.length;
  if (n === 1) return [Fr.create(values[0])];
  if ((n & (n - 1)) !== 0) throw new Error(`fft length ${n} is not a power of two`);

  const root = nthRootOfUnity(n);
  const omega = inverse ? Fr.inv(root) : root;

  const out = values.map((value) => Fr.create(value));

  // Bit-reversal permutation, so the butterflies below can run in place.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [out[i], out[j]] = [out[j], out[i]];
  }

  for (let length = 2; length <= n; length <<= 1) {
    const step = Fr.pow(omega, BigInt(n / length));
    for (let start = 0; start < n; start += length) {
      let twiddle = Fr.ONE;
      for (let k = 0; k < length / 2; k++) {
        const even = out[start + k];
        const odd = Fr.mul(out[start + k + length / 2], twiddle);
        out[start + k] = Fr.add(even, odd);
        out[start + k + length / 2] = Fr.sub(even, odd);
        twiddle = Fr.mul(twiddle, step);
      }
    }
  }

  if (inverse) {
    const nInv = Fr.inv(Fr.create(BigInt(n)));
    return out.map((value) => Fr.mul(value, nInv));
  }
  return out;
}

/**
 * Coefficients of the unique polynomial of degree < n taking `values[i]` at
 * `omega^i`.
 */
export function interpolate(values: bigint[]): bigint[] {
  return fft(values, true);
}

/** Evaluations of a coefficient-form polynomial over the whole domain. */
export function evaluateOverDomain(coefficients: bigint[], n: number): bigint[] {
  if (coefficients.length > n) throw new Error("polynomial does not fit in the domain");
  const padded = [...coefficients, ...new Array(n - coefficients.length).fill(0n)];
  return fft(padded);
}
