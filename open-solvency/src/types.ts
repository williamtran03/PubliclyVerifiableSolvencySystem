export type SolutionId = "published-ledger" | "zk-circuit" | "snarkless";
export type Connection = { rpc: string; registry: `0x${string}` };
export type Asset = { label: string; liabilities?: bigint; floor?: bigint; reserves: bigint };
export type Snapshot = {
  epoch: bigint;
  timestamp: bigint;
  assets: Asset[];
  commitment: string;
  data: unknown;
};
export type Check = { valid: boolean; message: string };
export type Solution = {
  id: SolutionId;
  name: string;
  description: string;
  disclosure: string;
  publication: string[];
  read(connection: Connection): Promise<Snapshot>;
  verify(connection: Connection, snapshot: Snapshot, file: string, account: string, expected: Map<number, bigint>, secret: string): Promise<Check>;
};
