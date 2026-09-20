import { encodeFunctionData, parseAbi, toHex, type Hex } from "viem";
import { client } from "./common.ts";
import { buildTree, keccakHash } from "@arms/published-ledger/prover/tree.ts";
import type { Connection, SolutionId } from "../types.ts";

const ledgerAbi = parseAbi(["function submitLedger(bytes32 snapshotId, uint256[][] identities, uint256[][] amounts)"]);
const zkAbi = parseAbi([
  "function epochCount() view returns (uint256)",
  "function epochContext(uint256) view returns (uint256)",
  "function submitEpoch(bytes proof, uint256 rootHash, uint64[3] floors, uint80[3] roundIds)",
]);
const kzgAbi = parseAbi([
  "struct G1Point { uint256 x; uint256 y; }",
  "struct GrandSum { G1Point balanceCommitment; G1Point shiftedCommitment; G1Point identityCommitment; uint256 totalLiabilities; G1Point sumProof; }",
  "struct RangeProof { G1Point[] bitCommitments; G1Point quotientCommitment; uint256[] values; G1Point batchProof; }",
  "function epochCount() view returns (uint256)",
  "function epochContext(uint256) view returns (uint256)",
  "function submitEpoch(GrandSum sum, RangeProof range)",
]);

const point = (value: { x: string; y: string }) => ({ x: BigInt(value.x), y: BigInt(value.y) });
const amount = (value: string) => {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid integer in the artifact.");
  return BigInt(value);
};

export async function publicationCall(solution: SolutionId, connection: Connection, artifact: string, supplement: File | undefined, rounds: string): Promise<Hex> {
  const raw = JSON.parse(artifact);
  const c = client(connection);
  if (solution === "published-ledger") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw.snapshotId ?? "") || !Array.isArray(raw.assets) || raw.assets.length === 0) throw new Error("Invalid public ledger.");
    const assetCount = await c.readContract({ address: connection.registry, abi: parseAbi(["function assetCount() view returns (uint256)"]), functionName: "assetCount" });
    if (raw.assets.length !== Number(assetCount)) throw new Error("The asset count does not match the registry.");
    for (const [i, asset] of raw.assets.entries()) {
      if (!Array.isArray(asset.entries) || asset.entries.length > 256) throw new Error(`Asset ${i}: invalid entry count.`);
      const entries = asset.entries.map((entry: { identityHash: string; balance: string }) => ({ username: "", identityHash: amount(entry.identityHash), balance: amount(entry.balance) }));
      const root = entries.length ? buildTree(entries, keccakHash).root : { hash: 0n, sum: 0n };
      if (root.hash !== amount(asset.rootHash) || root.sum !== amount(asset.totalLiabilities)) throw new Error(`Asset ${i}: entries do not match the root and total.`);
    }
    const identities = raw.assets.map((asset: { entries: { identityHash: string; balance: string }[] }) => asset.entries.map((entry) => amount(entry.identityHash)));
    const amounts = raw.assets.map((asset: { entries: { identityHash: string; balance: string }[] }) => asset.entries.map((entry) => amount(entry.balance)));
    return encodeFunctionData({ abi: ledgerAbi, functionName: "submitLedger", args: [raw.snapshotId as Hex, identities, amounts] });
  }
  if (solution === "zk-circuit") {
    if (!supplement) throw new Error("Select proof.bin.");
    if (!/^\d+$/.test(raw.rootHash ?? "") || !Array.isArray(raw.floors) || raw.floors.length !== 3) throw new Error("Invalid ZK epoch artifact.");
    const parsedRounds = rounds.split(",").map((value) => value.trim());
    if (parsedRounds.length !== 3 || parsedRounds.some((value) => !/^\d+$/.test(value))) throw new Error("Enter three comma-separated oracle round IDs.");
    const next = await c.readContract({ address: connection.registry, abi: zkAbi, functionName: "epochCount" });
    const context = await c.readContract({ address: connection.registry, abi: zkAbi, functionName: "epochContext", args: [next] });
    if (amount(raw.context) !== context) throw new Error("The proof context does not match this registry's next epoch.");
    const bytes = toHex(new Uint8Array(await supplement.arrayBuffer()));
    if (bytes === "0x") throw new Error("The proof file is empty.");
    return encodeFunctionData({ abi: zkAbi, functionName: "submitEpoch", args: [bytes, amount(raw.rootHash), raw.floors.map(amount) as [bigint, bigint, bigint], parsedRounds.map(amount) as [bigint, bigint, bigint]] });
  }
  if (!supplement) throw new Error("Select range-proof.json.");
  const range = JSON.parse(await supplement.text());
  const next = await c.readContract({ address: connection.registry, abi: kzgAbi, functionName: "epochCount" });
  const context = await c.readContract({ address: connection.registry, abi: kzgAbi, functionName: "epochContext", args: [next] });
  if (raw.registry?.toLowerCase() !== connection.registry.toLowerCase() || amount(raw.epochId) !== next || amount(raw.chainId) !== BigInt(await c.getChainId()) || amount(raw.context) !== context) throw new Error("The KZG artifact does not belong to this registry's next epoch.");
  if (!Array.isArray(range.bitCommitments) || !Array.isArray(range.values)) throw new Error("Invalid KZG range proof.");
  return encodeFunctionData({ abi: kzgAbi, functionName: "submitEpoch", args: [
    { balanceCommitment: point(raw.balanceCommitment), shiftedCommitment: point(raw.shiftedCommitment), identityCommitment: point(raw.identityCommitment), totalLiabilities: amount(raw.totalLiabilities), sumProof: point(raw.sumProof) },
    { bitCommitments: range.bitCommitments.map(point), quotientCommitment: point(range.quotientCommitment), values: range.values.map(amount), batchProof: point(range.batchProof) },
  ] });
}

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export async function submitWithWallet(connection: Connection, data: Hex, isCurrent: () => boolean = () => true): Promise<Hex> {
  const provider = (window as Window & { ethereum?: Provider }).ethereum;
  if (!provider) throw new Error("No browser wallet found.");
  const assertCurrent = () => { if (!isCurrent()) throw new Error("Publication inputs changed. Review them and try again."); };
  assertCurrent();
  const chain = BigInt(await provider.request({ method: "eth_chainId" }) as string);
  if (chain !== BigInt(await client(connection).getChainId())) throw new Error("Wallet and RPC are connected to different chains.");
  assertCurrent();
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts?.[0]) throw new Error("No wallet account available.");
  assertCurrent();
  const tx = { from: accounts[0], to: connection.registry, data };
  await provider.request({ method: "eth_call", params: [tx, "latest"] });
  assertCurrent();
  if (BigInt(await provider.request({ method: "eth_chainId" }) as string) !== chain) throw new Error("Wallet chain changed. Review the connection and try again.");
  assertCurrent();
  return await provider.request({ method: "eth_sendTransaction", params: [tx] }) as Hex;
}
