import { test } from "node:test";
import assert from "node:assert/strict";
import { Fr, domain, evaluateOverDomain, fft, interpolate, nthRootOfUnity } from "./field.ts";
import {
  add,
  divideByLinear,
  divideByVanishing,
  evaluate,
  evaluateVanishing,
  mul,
  sub,
  trim,
} from "./poly.ts";
import { batchOpen, batchVerify, commit, open, verify } from "./commit.ts";
import { generateSrs } from "./srs.ts";

const N = 8;
const srs = generateSrs(2 * N);

test("5 generates the whole multiplicative group", () => {
  // If it did not, the roots of unity below would land in a proper subgroup.
  assert.equal(Fr.pow(5n, (Fr.ORDER - 1n) / 2n), Fr.ORDER - 1n);
});

test("the domain is n distinct n-th roots of unity", () => {
  const points = domain(N);
  assert.equal(new Set(points).size, N);
  for (const point of points) assert.equal(Fr.pow(point, BigInt(N)), Fr.ONE);
  assert.notEqual(Fr.pow(nthRootOfUnity(N), BigInt(N / 2)), Fr.ONE);
});

test("interpolation and evaluation are inverses", () => {
  const values = [5n, 0n, 12n, 3n, 0n, 40n, 1n, 9n];
  const coefficients = interpolate(values);
  assert.deepEqual(evaluateOverDomain(coefficients, N), values);
  for (const [i, point] of domain(N).entries()) {
    assert.equal(evaluate(coefficients, point), values[i]);
  }
});

test("the sum over the domain is n times the constant coefficient", () => {
  // This identity is the entire grand sum protocol.
  const values = [5n, 0n, 12n, 3n, 0n, 40n, 1n, 9n];
  const coefficients = interpolate(values);
  const total = values.reduce((a, b) => a + b, 0n);
  assert.equal(Fr.mul(coefficients[0], BigInt(N)), Fr.create(total));
});

test("fft round-trips", () => {
  const values = Array.from({ length: N }, (_, i) => Fr.create(BigInt(i * 7 + 1)));
  assert.deepEqual(fft(fft(values), true), values);
});

test("dividing by (X - z) is exact for the shifted polynomial", () => {
  const poly = [3n, 1n, 4n, 1n, 5n];
  const z = 9n;
  const quotient = divideByLinear(sub(poly, [evaluate(poly, z)]), z);
  assert.deepEqual(trim(mul(quotient, [Fr.neg(z), 1n])), trim(sub(poly, [evaluate(poly, z)])));
});

test("dividing by the vanishing polynomial works exactly when it should", () => {
  const zeroOnH = mul([Fr.neg(Fr.ONE), ...new Array(N - 1).fill(0n), 1n], [7n, 2n]);
  const quotient = divideByVanishing(zeroOnH, N);
  assert.deepEqual(trim(quotient), trim([7n, 2n]));
  assert.throws(() => divideByVanishing(add(zeroOnH, [1n]), N), /not divisible/);
});

test("Z_H vanishes exactly on the domain", () => {
  for (const point of domain(N)) assert.equal(evaluateVanishing(point, N), Fr.ZERO);
  assert.notEqual(evaluateVanishing(12345n, N), Fr.ZERO);
});

test("a KZG opening verifies, and a wrong value does not", () => {
  const poly = interpolate([5n, 0n, 12n, 3n, 0n, 40n, 1n, 9n]);
  const commitment = commit(srs, poly);
  const z = 1234n;

  const opening = open(srs, poly, z);
  assert.ok(verify(srs, commitment, opening));
  assert.equal(verify(srs, commitment, { ...opening, value: opening.value + 1n }), false);
  assert.equal(verify(srs, commitment, { ...opening, z: z + 1n }), false);
});

test("opening at zero recovers the constant coefficient", () => {
  const poly = interpolate([5n, 0n, 12n, 3n, 0n, 40n, 1n, 9n]);
  const opening = open(srs, poly, 0n);
  assert.equal(opening.value, poly[0]);
  assert.ok(verify(srs, commit(srs, poly), opening));
});

test("a batched opening verifies, and a single tampered value breaks it", () => {
  const polys = [interpolate([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]), interpolate(new Array(N).fill(9n)), [1n, 1n]];
  const commitments = polys.map((poly) => commit(srs, poly));
  const z = 777n;
  const nu = 31337n;

  const { values, proof } = batchOpen(srs, polys, z, nu);
  assert.ok(batchVerify(srs, commitments, values, z, nu, proof));

  const tampered = [...values];
  tampered[1] = Fr.add(tampered[1], Fr.ONE);
  assert.equal(batchVerify(srs, commitments, tampered, z, nu, proof), false);
});

test("a commitment cannot be opened to a value the polynomial does not take", () => {
  const honest = interpolate([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
  const other = interpolate([1n, 2n, 3n, 4n, 5n, 6n, 7n, 9n]);
  const opening = open(srs, other, 555n);
  assert.equal(verify(srs, commit(srs, honest), opening), false);
});


test("constant and zero polynomials have valid identity opening proofs", () => {
  const srs = generateSrs(8);
  for (const value of [0n, 5n]) {
    const polynomial = [value];
    const commitment = commit(srs, polynomial);
    const opening = open(srs, polynomial, 3n);
    assert.equal(verify(srs, commitment, opening), true);
    assert.equal(verify(srs, commitment, { ...opening, value: value + 1n }), false);
  }
});
