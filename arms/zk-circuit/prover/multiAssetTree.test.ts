import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindRoot,
  buildTree,
  createBundle,
  createProof,
  deserializeBundle,
  epochContext,
  liabilitiesOf,
  parseHoldingsCsv,
  rootOf,
  serializeBundle,
  verifyBundle,
  FIELD_ORDER,
  type Customer,
  type Holding,
} from "./multiAssetTree.ts";

const holdings: Holding[] = [
  { username: "customer-123", salt: 84731920475619283746152039485761029384n, assetId: 0, amount: 2n },
  { username: "customer-456", salt: 19283746501928374650192837465019283746n, assetId: 1, amount: 10n },
  { username: "customer-789", salt: 55018273645019283746501928374650192837n, assetId: 2, amount: 5000n },
];
const CONTEXT = 7n;

const CIRCUIT_ROOT = 0x0c083286a0e73970b87241d9e37d86c6178fd3113e1f04045b603702225d3f06n;

const customer = (h: Holding, amount = h.amount): Customer => ({
  username: h.username,
  salt: h.salt,
  expectedAmounts: new Map([[h.assetId, amount]]),
});

function published() {
  const tree = buildTree(holdings);
  return { ...tree, root: bindRoot(tree.treeRoot, CONTEXT) };
}

test("the bound root matches the Noir circuit exactly", () => {
  assert.equal(published().root, CIRCUIT_ROOT);
});

test("liabilities are totalled per asset, not converted to one currency", () => {
  assert.deepEqual(liabilitiesOf(holdings), [2n, 10n, 5000n]);
});

test("the published root changes with the epoch context", () => {
  const { treeRoot } = buildTree(holdings);
  assert.notEqual(bindRoot(treeRoot, 7n), bindRoot(treeRoot, 8n));
});

test("the context mirrors the registry's keccak of chain, registry and epoch", () => {
  const registry = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
  const context = epochContext(31337n, registry, 0n);
  assert.ok(context < FIELD_ORDER);
  assert.notEqual(context, epochContext(31337n, registry, 1n));
  assert.notEqual(context, epochContext(1n, registry, 0n));
});

test("every customer verifies against the published root", () => {
  const { levels, root, holdings: padded } = published();
  for (const h of holdings) {
    assert.ok(verifyBundle(createBundle(h.username, padded, levels), customer(h), root, CONTEXT), h.username);
  }
});

test("a bundle round-trips through JSON", () => {
  const { levels, root, holdings: padded } = published();
  const bundle = deserializeBundle(serializeBundle(createBundle("customer-456", padded, levels)));
  assert.ok(verifyBundle(bundle, customer(holdings[1]), root, CONTEXT));
});

test("an entered zero matches an asset the customer does not hold", () => {
  const { levels, root, holdings: padded } = published();
  const bundle = createBundle("customer-123", padded, levels);
  const zeros = (other: bigint): Customer => ({ ...customer(holdings[0]), expectedAmounts: new Map([[0, 2n], [1, other], [2, 0n]]) });
  assert.ok(verifyBundle(bundle, zeros(0n), root, CONTEXT));
  assert.equal(verifyBundle(bundle, zeros(1n), root, CONTEXT), false);
});

test("a wrong amount, context or root fails", () => {
  const { levels, root, holdings: padded } = published();
  const bundle = createBundle("customer-123", padded, levels);
  assert.equal(verifyBundle(bundle, customer(holdings[0], 3n), root, CONTEXT), false);
  assert.equal(verifyBundle(bundle, customer(holdings[0]), root, CONTEXT + 1n), false);
  assert.equal(verifyBundle(bundle, customer(holdings[0]), root + 1n, CONTEXT), false);

  const tampered = structuredClone(bundle);
  tampered.parts[0].holding.amount += 1n;
  assert.equal(verifyBundle(tampered, customer(holdings[0], 3n), root, CONTEXT), false);
});

test("a customer sharing a username but holding a different salt rejects the leaf", () => {
  const { levels, root, holdings: padded } = published();
  const shared = createBundle("customer-123", padded, levels);
  const victim: Customer = {
    username: "customer-123",
    salt: 99n,
    expectedAmounts: new Map([[0, 2n]]),
  };
  assert.equal(verifyBundle(shared, victim, root, CONTEXT), false);
});

test("one leaf cannot be counted twice by giving it a second path encoding", () => {
  const { levels, root, holdings: padded } = published();
  const part = createProof(0, padded, levels);
  const alias = { ...part, pathIndices: [2, ...part.pathIndices.slice(1)] };
  const bundle = { username: "customer-123", parts: [part, alias] };

  assert.equal(verifyBundle(bundle, customer(holdings[0], 4n), root, CONTEXT), false);
  assert.equal(rootOf(alias), null);
});

test("a proof with the wrong number of levels is rejected", () => {
  const { levels, holdings: padded } = published();
  const proof = createProof(0, padded, levels);
  assert.equal(rootOf({ ...proof, siblings: proof.siblings.slice(1), pathIndices: proof.pathIndices.slice(1) }), null);
});

test("a bundle claiming someone else's leaf is rejected", () => {
  const { levels, root, holdings: padded } = published();
  const bundle = { username: "customer-123", parts: [createProof(1, padded, levels)] };
  assert.equal(verifyBundle(bundle, customer(holdings[0]), root, CONTEXT), false);
});

test("the holdings CSV rejects untracked assets, long names and a second salt per customer", () => {
  const header = "username,salt,assetId,amount\n";
  assert.throws(() => parseHoldingsCsv(header + "a,1,3,1"), /not tracked/);
  assert.throws(() => parseHoldingsCsv(header + `${"x".repeat(32)},1,0,1`), /at most 31/);
  assert.throws(() => parseHoldingsCsv(header + "a,1,0,1\na,2,1,1"), /two salts/);
  assert.equal(parseHoldingsCsv(header + "a,1,0,1\na,1,1,1").length, 2);
});
