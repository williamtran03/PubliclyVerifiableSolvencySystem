import { deserializeBundle, verifyBundle, type CustomerBundle } from "@prover/multi-asset/multiAssetTree.ts";
import { $, ASSET_NAMES, loadSettings, readEpoch, usd, type Epoch } from "./chain.ts";

const SESSION_KEY = "northwind.account";

let bundle: CustomerBundle | null = null;
let epoch: Epoch | null = null;

async function signIn(accountId: string) {
  const status = $<HTMLParagraphElement>("#loginStatus");
  status.className = "note";
  status.textContent = "Looking up your account…";

  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(accountId)) {
    status.className = "note bad";
    status.textContent = "That does not look like an account ID.";
    return;
  }

  // The dev server answers unknown paths with the app shell, so a missing bundle
  // arrives as 200 HTML rather than a 404.
  let loaded: CustomerBundle;
  try {
    const response = await fetch(`/bundles/${encodeURIComponent(accountId)}.json`);
    if (!response.ok) throw new Error("not found");
    loaded = deserializeBundle(await response.text());
    if (loaded.username !== accountId) throw new Error("mismatched bundle");
  } catch {
    status.className = "note bad";
    status.textContent = "No account found with that ID.";
    return;
  }

  bundle = loaded;
  try {
    sessionStorage.setItem(SESSION_KEY, accountId);
  } catch {
    /* private browsing */
  }

  $("#loginView").hidden = true;
  $("#accountView").hidden = false;
  $("#accountLine").textContent = `Signed in as ${bundle.username}.`;
  renderHoldings();
  await loadEpoch();
}

function renderHoldings() {
  const totals = new Map<number, bigint>();
  for (const part of bundle!.parts) {
    totals.set(part.holding.assetId, (totals.get(part.holding.assetId) ?? 0n) + part.holding.amount);
  }

  $("#holdings").innerHTML = [...totals]
    .map(
      ([assetId, amount]) =>
        `<label>${ASSET_NAMES[assetId]}
           <input class="expected" data-asset="${assetId}" value="${amount}" inputmode="numeric" />
         </label>`,
    )
    .join("");
  $("#verifyResult").hidden = true;
}

async function loadEpoch() {
  const error = $<HTMLDivElement>("#epochError");
  try {
    epoch = await readEpoch(loadSettings());
    error.hidden = true;
    $("#rootHash").textContent = `0x${epoch.rootHash.toString(16).padStart(64, "0")}`;
    $("#liabilities").textContent = usd(epoch.liabilitiesUsd);
    $("#assets").textContent = usd(epoch.assetsUsd);
    $("#timestamp").textContent = new Date(Number(epoch.timestamp) * 1000).toLocaleString();
  } catch (cause) {
    epoch = null;
    error.hidden = false;
    error.textContent =
      (cause instanceof Error ? cause.message : String(cause)) +
      " Set the registry on the Solvency page first.";
  }
}

$<HTMLButtonElement>("#verifyBtn").addEventListener("click", () => {
  const result = $<HTMLDivElement>("#verifyResult");
  result.hidden = false;

  if (!bundle || !epoch) {
    result.className = "result bad";
    result.textContent = "Cannot reach the registry, so there is nothing to check against yet.";
    return;
  }

  const expected = new Map<number, bigint>();
  for (const input of document.querySelectorAll<HTMLInputElement>(".expected")) {
    const value = input.value.trim();
    if (!/^\d+$/.test(value)) {
      result.className = "result bad";
      result.textContent = "Balances must be whole numbers.";
      return;
    }
    expected.set(Number(input.dataset.asset), BigInt(value));
  }

  const valid = verifyBundle(bundle, expected, epoch.rootHash, epoch.liabilitiesUsd);
  result.className = `result ${valid ? "ok" : "bad"}`;
  result.textContent = valid
    ? "Included. These balances are committed to in the published commitment, and are counted in the liabilities total the reserves were checked against."
    : "Not included. This proof does not reconstruct the published commitment for the balances entered — either a balance is wrong, or this epoch does not cover your account.";
});

$<HTMLButtonElement>("#signInBtn").addEventListener("click", () =>
  signIn($<HTMLInputElement>("#accountId").value.trim()),
);

$<HTMLInputElement>("#accountId").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $<HTMLButtonElement>("#signInBtn").click();
});

$<HTMLButtonElement>("#signOutBtn").addEventListener("click", () => {
  bundle = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing */
  }
  $("#accountView").hidden = true;
  $("#loginView").hidden = false;
  $<HTMLInputElement>("#accountId").value = "";
  $<HTMLParagraphElement>("#loginStatus").textContent = "";
});

try {
  const remembered = sessionStorage.getItem(SESSION_KEY);
  if (remembered) signIn(remembered);
} catch {
  /* private browsing */
}
