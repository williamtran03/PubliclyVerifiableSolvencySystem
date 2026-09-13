import { $, ASSET_NAMES, hex, loadSettings, readEpoch } from "./chain.ts";

const PASSCODE = "northwind-ops";
const SESSION_KEY = "northwind.operator";

type Ledger = {
  rootHash: string;
  epochId: string;
  capacity: number;
  liabilities: string[];
  floors: string[];
  rows: { username: string; assetId: number; amount: string }[];
};

async function load() {
  const error = $<HTMLDivElement>("#error");

  let ledger: Ledger;
  try {
    ledger = await fetch("/operator/ledger.json").then((r) => r.json());
  } catch {
    error.hidden = false;
    error.textContent = "No ledger found. Run `make zk-fixtures` to build one.";
    return;
  }

  $("#ledgerRows").innerHTML = ledger.rows
    .map((row) => `<tr><td>${row.username}</td><td>${ASSET_NAMES[row.assetId]}</td><td>${row.amount}</td></tr>`)
    .join("");
  $("#ledgerCount").textContent = `· ${ledger.rows.length} of ${ledger.capacity} slots`;
  $("#capacityNote").textContent =
    `The circuit is fixed at ${ledger.capacity} slots; unused ones are padded with randomly salted ` +
    `zero entries and all leaves are shuffled, so neither the customer count nor the order leaks.`;
  $("#ledgerRoot").textContent = hex(BigInt(ledger.rootHash));

  try {
    const epoch = await readEpoch(loadSettings());
    $("#publishedRoot").textContent = hex(epoch.rootHash);
    $("#assetRows").innerHTML = ASSET_NAMES.map(
      (name, i) =>
        `<tr><td>${name}</td><td>${ledger.liabilities[i]}</td><td>${epoch.floors[i]}</td>` +
        `<td>${epoch.reserveUnits[i]}</td></tr>`,
    ).join("");

    const matches = epoch.rootHash === BigInt(ledger.rootHash) && epoch.epochId.toString() === ledger.epochId;
    const reconcile = $<HTMLDivElement>("#reconcile");
    reconcile.hidden = false;
    reconcile.className = `result ${matches ? "ok" : "bad"}`;
    reconcile.textContent = matches
      ? "In sync. The latest published commitment was built from this ledger."
      : "Out of sync. This ledger was not the one behind the latest epoch — fetch a snapshot, rebuild, prove and submit a new epoch.";
    error.hidden = true;
  } catch (cause) {
    error.hidden = false;
    error.textContent =
      (cause instanceof Error ? cause.message : String(cause)) + " Set the registry on the Solvency page first.";
  }
}

function signIn(passcode: string) {
  const status = $<HTMLParagraphElement>("#loginStatus");
  if (passcode !== PASSCODE) {
    status.className = "note bad";
    status.textContent = "Incorrect passcode.";
    return;
  }
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
  }
  status.textContent = "";
  $("#loginView").hidden = true;
  $("#consoleView").hidden = false;
  load();
}

$<HTMLButtonElement>("#signInBtn").addEventListener("click", () => signIn($<HTMLInputElement>("#passcode").value));

$<HTMLInputElement>("#passcode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $<HTMLButtonElement>("#signInBtn").click();
});

$<HTMLButtonElement>("#signOutBtn").addEventListener("click", () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
  }
  $("#consoleView").hidden = true;
  $("#loginView").hidden = false;
  $<HTMLInputElement>("#passcode").value = "";
});

try {
  if (sessionStorage.getItem(SESSION_KEY)) signIn(PASSCODE);
} catch {
}
