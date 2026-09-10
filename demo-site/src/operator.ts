import { $, ASSET_NAMES, loadSettings, readEpoch, usd } from "./chain.ts";

const PASSCODE = "northwind-ops";
const SESSION_KEY = "northwind.operator";

type Ledger = {
  prices: string[];
  rootHash: string;
  totalUsd: string;
  capacity: number;
  rows: { username: string; assetId: number; amount: string; valueUsd: string }[];
};

const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

async function load() {
  const error = $<HTMLDivElement>("#error");

  let ledger: Ledger;
  try {
    ledger = await fetch("/operator/ledger.json").then((r) => r.json());
  } catch {
    error.hidden = false;
    error.textContent = "No ledger found. Run `make multiasset-fixtures` to build one.";
    return;
  }

  $("#ledgerRows").innerHTML = ledger.rows
    .map(
      (row) =>
        `<tr><td>${row.username}</td><td>${ASSET_NAMES[row.assetId]}</td>` +
        `<td>${row.amount}</td><td>${usd(BigInt(row.valueUsd))}</td></tr>`,
    )
    .join("");
  $("#ledgerCount").textContent = `· ${ledger.rows.length} of ${ledger.capacity} slots`;
  $("#capacityNote").textContent =
    `The circuit is fixed at ${ledger.capacity} slots; unused ones are padded with zero-value ` +
    `entries so the tree shape, and therefore the proof, stays constant.`;
  $("#ledgerTotal").textContent = usd(BigInt(ledger.totalUsd));
  $("#ledgerRoot").textContent = hex(BigInt(ledger.rootHash));

  try {
    const epoch = await readEpoch(loadSettings());
    $("#publishedTotal").textContent = usd(epoch.liabilitiesUsd);
    $("#publishedRoot").textContent = hex(epoch.rootHash);
    $("#assets").textContent = usd(epoch.assetsUsd);
    $("#liabilities").textContent = usd(epoch.liabilitiesUsd);
    $("#surplus").textContent = usd(epoch.assetsUsd - epoch.liabilitiesUsd);
    $("#priceRows").innerHTML = epoch.prices
      .map(
        (price, i) =>
          `<tr><td>${ASSET_NAMES[i]}</td><td>${usd(price)}</td>` +
          `<td class="muted">#${epoch.roundIds[i]}</td></tr>`,
      )
      .join("");

    const matches =
      epoch.rootHash === BigInt(ledger.rootHash) && epoch.liabilitiesUsd === BigInt(ledger.totalUsd);
    const reconcile = $<HTMLDivElement>("#reconcile");
    reconcile.hidden = false;
    reconcile.className = `result ${matches ? "ok" : "bad"}`;
    reconcile.textContent = matches
      ? "In sync. The published commitment and total match this ledger exactly."
      : "Out of sync. This ledger has changed since the last epoch was published — regenerate the proof and submit a new epoch.";
    error.hidden = true;
  } catch (cause) {
    error.hidden = false;
    error.textContent =
      (cause instanceof Error ? cause.message : String(cause)) +
      " Set the registry on the Solvency page first.";
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
    /* private browsing */
  }
  status.textContent = "";
  $("#loginView").hidden = true;
  $("#consoleView").hidden = false;
  load();
}

$<HTMLButtonElement>("#signInBtn").addEventListener("click", () =>
  signIn($<HTMLInputElement>("#passcode").value),
);

$<HTMLInputElement>("#passcode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $<HTMLButtonElement>("#signInBtn").click();
});

$<HTMLButtonElement>("#signOutBtn").addEventListener("click", () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing */
  }
  $("#consoleView").hidden = true;
  $("#loginView").hidden = false;
  $<HTMLInputElement>("#passcode").value = "";
});

try {
  if (sessionStorage.getItem(SESSION_KEY)) signIn(PASSCODE);
} catch {
  /* private browsing */
}
