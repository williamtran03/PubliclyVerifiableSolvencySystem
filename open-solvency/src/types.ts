export type SolutionId = "published-ledger" | "zk-circuit" | "snarkless";
export type Connection = { rpc: string; registry: `0x${string}` };
export type Asset = { label: string; token?: string; unitDecimals?: number; unitDescription?: string; liabilities?: bigint; floor?: bigint; reserves: bigint };
export type Freshness = { current: boolean; age: bigint; maxAge: bigint };
export type PublicLedgerEntry = { identity: bigint; amount: bigint };
export type PublicLedgerAsset = { entries: PublicLedgerEntry[]; rootHash: bigint; total: bigint };
export type Snapshot = {
  epoch: bigint;
  timestamp: bigint;
  assets: Asset[];
  commitment: string;
  data: unknown;
  freshness?: Freshness;
  publicLedger?: PublicLedgerAsset[];
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
