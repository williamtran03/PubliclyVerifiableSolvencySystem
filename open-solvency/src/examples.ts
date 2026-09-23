import type { Snapshot, SolutionId } from "./types.ts";

export type PublicExample = {
  method: SolutionId;
  registry: string;
  epoch: string;
  commitment: string;
  account: string;
  balances: [number, string][];
  secret: string;
  bundle: unknown;
};

export type PublicExamples = { version: 1; chainId: 11155111; examples: PublicExample[] };

export function matchingExample(records: PublicExamples[], method: SolutionId, registry: string, snapshot: Snapshot) {
  return records.filter(record => record.version === 1 && record.chainId === 11155111)
    .flatMap(record => record.examples).find(example => example.method === method &&
      example.registry.toLowerCase() === registry.toLowerCase() && example.epoch === snapshot.epoch.toString() &&
      example.commitment === snapshot.commitment);
}
