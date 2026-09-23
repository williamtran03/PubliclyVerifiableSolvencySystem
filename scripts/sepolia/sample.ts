import type { SolutionId } from "../../open-solvency/src/types.ts";

export const SAMPLE_SECRET = "84731920475619283746152039485761029384";
export const samples: Record<SolutionId, { account: string; balances: [number, string][]; secret: string }> = {
  "published-ledger": { account: "alice", balances: [[0, "100"], [1, "3"]], secret: "" },
  "zk-circuit": { account: "customer-123", balances: [[0, "250000000"]], secret: SAMPLE_SECRET },
  snarkless: { account: "customer-123", balances: [[0, "12550"]], secret: SAMPLE_SECRET },
};

type Parser = (value: any) => unknown;
const decimal: Parser = value => {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw new Error("Invalid example integer.");
  return value;
};
const integer: Parser = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 256) throw new Error("Invalid example index.");
  return value;
};
const hex: Parser = value => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Invalid example hash.");
  return value;
};
const literal = (expected: string): Parser => value => {
  if (value !== expected) throw new Error("Only the documented fictional customer may be exported.");
  return value;
};
const array = (parse: Parser): Parser => value => {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Invalid example array.");
  return value.map(parse);
};
const object = (fields: Record<string, Parser>): Parser => value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid example object.");
  // Reconstruct only documented fields; never copy arbitrary private metadata.
  return Object.fromEntries(Object.entries(fields).map(([key, parse]) => [key, parse(value[key])]));
};

const parsers: Record<SolutionId, Parser> = {
  "published-ledger": object({
    snapshotId: hex, customerId: literal("alice"), name: literal("Alice Example"), dateOfBirth: literal("2000-01-01"),
    parts: array(object({ salt: hex, assetId: integer, partIndex: integer, proof: object({
      rootHash: decimal, rootSum: decimal,
      entry: object({ username: literal(""), identityHash: decimal, balance: decimal }),
      siblingHashes: array(decimal), siblingSums: array(decimal), pathIndices: array(integer),
    }) })),
  }),
  "zk-circuit": object({ username: literal("customer-123"), parts: array(object({
    holding: object({ username: literal("customer-123"), salt: literal(SAMPLE_SECRET), assetId: integer, amount: decimal }),
    siblings: array(decimal), pathIndices: array(integer),
  })) }),
  snarkless: object({ username: literal("customer-123"), index: integer, identity: decimal, balance: literal("12550"), proof: object({ x: decimal, y: decimal }) }),
};

export function publicSampleBundle(method: SolutionId, value: unknown): unknown {
  return parsers[method](value);
}
