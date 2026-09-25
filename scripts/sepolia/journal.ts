import { getAddress, keccak256, type Address, type Hex, type TransactionReceipt } from "viem";
import type { Deployment } from "./network.ts";

export type PendingTransaction = {
  step: string;
  label: string;
  hash: Hex;
  serializedTransaction?: Hex;
  sender?: Address;
  nonce?: number;
  epochId?: string;
};

export async function broadcastJournaled(
  record: Deployment,
  persist: (next: Deployment) => void,
  pending: PendingTransaction & { serializedTransaction: Hex },
  broadcast: (raw: Hex) => Promise<Hex>,
) {
  if (record.pending) throw new Error("Recover the pending transaction before sending another.");
  if (keccak256(pending.serializedTransaction) !== pending.hash) throw new Error("Signed transaction hash mismatch.");
  const next = { ...record, pending };
  persist(next);
  Object.assign(record, next);
  const hash = await broadcast(pending.serializedTransaction);
  if (hash !== pending.hash) throw new Error("RPC returned a different transaction hash; retain the journal and check the RPC.");
  return hash;
}

export function finalizeTransaction(
  record: Deployment,
  persist: (next: Deployment) => void,
  receipt: TransactionReceipt,
  epoch?: Deployment["epochs"][number],
) {
  const pending = record.pending;
  if (!pending || pending.hash !== receipt.transactionHash) throw new Error("Receipt does not match the pending transaction.");
  const next = {
    ...record,
    contracts: { ...record.contracts },
    deployBlocks: { ...record.deployBlocks },
    epochs: [...record.epochs],
    transactions: [...record.transactions],
  };
  if (!next.transactions.some(tx => tx.hash === receipt.transactionHash)) {
    next.transactions.push({ step: `${pending.step} ${pending.label}`.trim(), hash: receipt.transactionHash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });
  }
  if (receipt.status === "success") {
    if (pending.label.startsWith("deploy ")) {
      if (!receipt.contractAddress) throw new Error("Deployment receipt has no contract address.");
      next.contracts[pending.step] = getAddress(receipt.contractAddress);
      next.deployBlocks[pending.step] = receipt.blockNumber.toString();
    }
    if (epoch && !next.epochs.some(item => item.hash === receipt.transactionHash)) next.epochs.push(epoch);
  }
  delete next.pending;
  persist(next);
  Object.assign(record, next);
  delete record.pending;
}
