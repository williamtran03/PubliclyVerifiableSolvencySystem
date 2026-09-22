import type { Connection, SolutionId } from "./types.ts";

export type Network = { name: string; explorer: string; connections: Record<SolutionId, Connection> };

const known: Record<number, { name: string; rpc: string; explorer: string }> = {
  11155111: { name: "Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
};
const arms: SolutionId[] = ["published-ledger", "zk-circuit", "snarkless"];

export function deployedNetworks(records: unknown[]): Network[] {
  return records.flatMap(record => {
    const { chainId, contracts } = (record ?? {}) as { chainId?: unknown; contracts?: Record<string, unknown> };
    const network = typeof chainId === "number" ? known[chainId] : undefined;
    const registries = arms.map(arm => contracts?.[arm]);
    if (!network || !registries.every(address => typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address))) return [];
    const connections = Object.fromEntries(arms.map((arm, i) => [arm, { rpc: network.rpc, registry: registries[i] as `0x${string}` }]));
    return [{ name: network.name, explorer: network.explorer, connections: connections as Network["connections"] }];
  });
}

export function explorerLink(networks: Network[], solution: SolutionId, registry: string) {
  const network = networks.find(n => n.connections[solution].registry.toLowerCase() === registry.toLowerCase());
  return network && { name: network.name, url: `${network.explorer}/address/${network.connections[solution].registry}` };
}
