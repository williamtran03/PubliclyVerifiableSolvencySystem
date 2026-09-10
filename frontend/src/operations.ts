import { usd } from "./minimumClient.ts";
import { short } from "./treeView.ts";
import { connectionPanel, markNavigation, output, element, button, loadState } from "./shared.ts";

markNavigation();
const connection = connectionPanel();
const STATUS = ["None", "Pending", "Approved", "Rejected", "Retired"];

function fill(id: string, rows: string[][], empty: string, columns: number) {
  const body = element(id);
  body.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = columns;
    cell.textContent = empty;
    row.append(cell);
    body.append(row);
    return;
  }
  for (const values of rows) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

button("loadState").onclick = async () => {
  await loadState(
    () => connection().auditQueue(),
    (state) => {
      if (state.status === "loading") return output("roles", "Reading registry…");
      if (state.status === "error") return output("roles", `ERROR: ${state.error}`);
      const queue = state.value!;
      output("roles", `Company: ${queue.company}\nAuditor: ${queue.auditor}\nAssets: ${queue.assets.length}\nSnapshots: ${queue.liabilities.length}`);
      fill(
        "assets",
        queue.assets.map((a) => [
          String(a.id),
          a.nativeAsset ? "native" : short(a.token, 8, 6),
          short(a.reserve, 8, 6),
          a.ownershipVerified ? "verified" : "unverified",
          STATUS[a.status] + (a.removalPending ? " · removal pending" : ""),
        ]),
        "No assets registered.",
        5,
      );
      fill(
        "snapshots",
        queue.liabilities.map((l) => [
          short(l.id, 10, 6),
          usd(l.liability.rootSum),
          String(l.liability.snapshotBlock),
          STATUS[l.liability.status] + (l.liability.removalPending ? " · removal pending" : ""),
          l.proposal.exists ? (l.proposal.decided ? "decided" : "awaiting auditor") : "none",
        ]),
        "No snapshots submitted.",
        5,
      );
    },
  );
};
