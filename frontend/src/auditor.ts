import { createWalletClient, custom, type Hex, type EIP1193Provider } from "viem";
import { minimumAbi } from "./minimumAbi.ts";
import { stringify } from "../../prover/minimum/tree.ts";
import { connectionPanel, markNavigation, output, button, value, loadState } from "./shared.ts";

markNavigation();
const connection = connectionPanel();

button("refreshAudit").onclick = async () => {
  await loadState(
    () => connection().auditQueue(),
    (s) =>
      output("auditQueue", s.status === "ready" ? stringify(s.value) : s.status === "loading" ? "Reading proposals…" : `ERROR: ${s.error}`),
  );
};

button("auditorSubmit").onclick = async () => {
  try {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) throw Error("Connect an injected wallet");
    const c = connection();
    const wallet = createWalletClient({ transport: custom(provider) });
    const [account] = await wallet.requestAddresses();
    const auditor = await c.client.readContract({ address: c.address, abi: minimumAbi, functionName: "auditor" });
    if (account.toLowerCase() !== auditor.toLowerCase()) throw Error("Wallet is not the appointed auditor");
    if ((await wallet.getChainId()) !== (await c.client.getChainId())) throw Error("Wallet network differs from RPC");
    const action = value("auditAction"),
      id = value("actionId"),
      approved = value("decision") === "true";
    let hash: Hex;
    if (action === "finalizeClaim" && approved) {
      const queue = await c.auditQueue();
      const selected = queue.liabilities.find((l) => l.id.toLowerCase() === id.toLowerCase());
      if (!(selected?.review as { readyForReserveAttestation?: boolean })?.readyForReserveAttestation)
        throw Error("Historical reserve, timestamp, eligibility, freshness or solvency checks failed. Refresh the auditor queue.");
    }
    if (action === "approveAsset" || action === "verifyRemoveAsset") {
      if (!/^[1-9][0-9]*$/.test(id)) throw Error("Invalid asset ID");
      hash = await wallet.writeContract({ address: c.address, abi: minimumAbi, functionName: action, args: [BigInt(id), approved], account, chain: null });
    } else if (action === "verifyAddLiability" || action === "verifyRemoveLiability" || action === "finalizeClaim") {
      if (!/^0x[0-9a-f]{64}$/i.test(id)) throw Error("Invalid snapshot ID");
      hash = await wallet.writeContract({ address: c.address, abi: minimumAbi, functionName: action, args: [id as Hex, approved], account, chain: null });
    } else throw Error("Unknown action");
    output("auditResult", "Submitted " + hash);
    const receipt = await c.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw Error("Transaction reverted");
    output("auditResult", "Confirmed " + hash);
  } catch (e) {
    output("auditResult", `ERROR: ${e instanceof Error ? e.message : e}`);
  }
};
