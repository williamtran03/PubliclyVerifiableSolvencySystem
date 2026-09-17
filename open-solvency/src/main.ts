import { isAddress } from "viem";
import { zk } from "./solutions/zk.ts";
import { ledger } from "./solutions/ledger.ts";
import { kzg } from "./solutions/kzg.ts";
import { inspectArtifact } from "./solutions/company.ts";
import { publicationCall, submitWithWallet } from "./solutions/publish.ts";
import type { Connection, Snapshot, Solution, SolutionId } from "./types.ts";
import "./style.css";

const solutions: Solution[] = [zk, ledger, kzg];
const stored = (() => { try { return JSON.parse(localStorage.getItem("opensolvency.settings") ?? "{}"); } catch { return {}; } })();
let selected: Solution = solutions.find((s) => s.id === stored.solution) ?? zk;
let snapshot: Snapshot | null = null;
let snapshotConnection: string | null = null;
let role: "customer" | "company" = "customer";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="masthead"><div class="masthead-inner"><span class="mark">OpenSolvency <span>proof of reserves</span></span><div class="roles" role="tablist" aria-label="View"><button id="customerTab" role="tab" aria-selected="true">Customer</button><button id="companyTab" role="tab" aria-selected="false">Company</button></div></div></header>
  <div class="workspace">
    <aside class="rail">
      <section class="rail-block"><h2 class="rail-title">Proof method</h2><div id="solutions" class="methods"></div><p id="disclosure" class="note"></p></section>
      <section class="rail-block"><h2 class="rail-title">Registry</h2><label>RPC endpoint<input id="rpc" type="url" placeholder="https://…" value="${escapeHtml(stored.rpc ?? "http://127.0.0.1:8545")}" /></label><label>Contract address<input id="registry" spellcheck="false" placeholder="0x…" value="${escapeHtml(stored.registry ?? "")}" /></label><div class="actions"><button id="load" class="btn btn-primary">Load snapshot</button></div><p id="loadStatus" class="status" role="status"></p></section>
    </aside>
    <main>
      <section id="snapshot" class="card" hidden></section>
      <section id="customerView" class="card">
        <div class="card-head"><h2>Verify your balances</h2><p>No wallet required</p></div>
        <div class="card-body"><p id="customerHelp" class="note"></p><div class="field-grid"><label>Customer ID<input id="account" autocomplete="off" placeholder="e.g. customer-123" /></label><label>Inclusion proof (.json)<input id="proof" type="file" accept=".json,application/json" /></label></div><div id="balances" class="balances"></div><label id="secretLabel">Account secret<input id="secret" autocomplete="off" placeholder="ZK and KZG only" /></label><div class="actions"><button id="verify" class="btn btn-primary">Verify proof</button></div><p id="verifyStatus" class="status" role="status"></p></div>
      </section>
      <section id="companyView" class="card" hidden>
        <div class="card-head"><h2>Publish a snapshot</h2><p>Requires the company wallet</p></div>
        <div class="card-body">
          <p class="note">Generate proofs with the existing CLI tools, then load the artifacts here. Keep private customer bundles out of the website and out of public builds.</p>
          <ol id="publication" class="steps"></ol>
          <p id="companyCheck" class="callout">Load the registry to review its current epoch and reserves.</p>
          <h3 class="subhead">Compare a published artifact</h3>
          <div class="field-grid"><label>Epoch artifact (.json)<input id="artifact" type="file" accept=".json,application/json" /></label></div>
          <div class="actions"><button id="inspect" class="btn">Compare with registry</button></div>
          <p id="inspectStatus" class="status" role="status"></p>
          <h3 class="subhead">Submit the next epoch</h3>
          <div class="field-grid"><label id="nextLabel">New artifact<input id="nextArtifact" type="file" accept=".json,application/json" /></label><label id="supplementLabel">Additional proof<input id="supplement" type="file" /></label></div>
          <label id="roundsLabel">Oracle round IDs (three comma-separated values)<input id="rounds" placeholder="123, 456, 789" /></label>
          <div class="actions"><button id="publish" class="btn btn-primary">Publish with company wallet</button></div>
          <p id="publishStatus" class="status" role="status"></p>
        </div>
      </section>
    </main>
  </div>
  <div class="footer-wrap"><footer>A valid customer proof confirms inclusion in the published snapshot. It cannot reveal undisclosed liabilities or lock reserves.</footer></div>`;

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function setStatus(id: string, message: string, ok?: boolean) { const node = el<HTMLElement>(id); node.textContent = message; node.className = `status${ok === undefined ? "" : ok ? " ok" : " bad"}`; }
function renderSolutions() {
  el<HTMLDivElement>("solutions").innerHTML = solutions.map((s) => `<button class="method" data-id="${s.id}" aria-pressed="${s.id === selected.id}"><span class="method-name">${escapeHtml(s.name)}</span><span class="method-desc">${escapeHtml(s.description)}</span></button>`).join("");
  el<HTMLElement>("disclosure").textContent = selected.disclosure;
  el<HTMLElement>("customerHelp").textContent = selected.id === "snarkless"
    ? "Use the balance from your own records. The JSON file stays local; KZG sends the identity commitment, balance, and opening to your RPC endpoint for verifyInclusion."
    : "Use balances from your own records. The JSON file and your secret stay in your browser during local verification.";
  el<HTMLOListElement>("publication").innerHTML = selected.publication.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  el<HTMLElement>("secretLabel").hidden = selected.id === "published-ledger";
  el<HTMLElement>("supplementLabel").hidden = selected.id === "published-ledger";
  el<HTMLElement>("roundsLabel").hidden = selected.id !== "zk-circuit";
  el<HTMLElement>("nextLabel").firstChild!.textContent = selected.id === "published-ledger" ? "Merkle-sum ledger (ledger.json)" : "New epoch artifact (epoch.json)";
  el<HTMLElement>("supplementLabel").firstChild!.textContent = selected.id === "snarkless" ? "Range proof (range-proof.json)" : "ZK proof (proof.bin)";
  renderBalances();
  document.querySelectorAll<HTMLButtonElement>(".method").forEach((button) => button.addEventListener("click", () => {
    selected = solutions.find((s) => s.id === button.dataset.id as SolutionId)!;
    snapshot = null;
    snapshotConnection = null;
    el<HTMLElement>("snapshot").hidden = true;
    el<HTMLInputElement>("proof").value = "";
    el<HTMLInputElement>("artifact").value = "";
    el<HTMLInputElement>("nextArtifact").value = "";
    el<HTMLInputElement>("supplement").value = "";
    setStatus("loadStatus", "Method changed. Reload the snapshot.");
    setStatus("verifyStatus", "");
    renderSolutions();
    save();
  }));
}
function renderBalances() {
  const count = snapshot?.assets.length ?? (selected.id === "zk-circuit" ? 3 : 1);
  el<HTMLElement>("balances").innerHTML = Array.from({ length: count }, (_, i) => `<label>${escapeHtml(snapshot?.assets[i]?.label ?? `Asset ${i}`)}<input class="balance" data-asset="${i}" inputmode="numeric" placeholder="balance in base units" /></label>`).join("");
}
function save() {
  try { localStorage.setItem("opensolvency.settings", JSON.stringify({ solution: selected.id, rpc: el<HTMLInputElement>("rpc").value.trim(), registry: el<HTMLInputElement>("registry").value.trim() })); } catch { /* storage optional */ }
}
function connection(): Connection {
  const rpc = el<HTMLInputElement>("rpc").value.trim();
  const registry = el<HTMLInputElement>("registry").value.trim();
  if (!/^https?:\/\//.test(rpc)) throw new Error("Enter an HTTP(S) RPC endpoint.");
  if (!isAddress(registry)) throw new Error("Enter a valid registry address.");
  return { rpc, registry };
}
function renderSnapshot(value: Snapshot) {
  const rows = value.assets.map((asset) => `<tr><td>${escapeHtml(asset.label)}</td><td>${asset.reserves}</td><td>${asset.liabilities ?? "private"}</td><td>${asset.floor ?? "—"}</td></tr>`).join("");
  const panel = el<HTMLElement>("snapshot");
  panel.innerHTML = `<div class="card-head"><h2>Published snapshot</h2><p>Read from the contract</p></div><dl class="readout"><div><dt>Epoch</dt><dd>${value.epoch}</dd></div><div><dt>Published</dt><dd>${escapeHtml(new Date(Number(value.timestamp) * 1000).toLocaleString("en-GB"))}</dd></div><div class="wide"><dt>Commitment</dt><dd class="small">${escapeHtml(value.commitment)}</dd></div></dl><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Reserves</th><th>Liabilities</th><th>Reserve floor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  panel.hidden = false;
  el<HTMLElement>("companyCheck").textContent = `Current snapshot: epoch ${value.epoch}, published ${new Date(Number(value.timestamp) * 1000).toLocaleString("en-GB")}. Compare these figures with your internal records before creating a new proof.`;
  renderBalances();
}
el<HTMLButtonElement>("load").addEventListener("click", async () => {
  snapshot = null;
  el<HTMLElement>("snapshot").hidden = true;
  setStatus("loadStatus", "Reading the smart contract …");
  try { const c = connection(); const value = await selected.read(c); snapshot = value; snapshotConnection = `${c.rpc}|${c.registry.toLowerCase()}`; save(); renderSnapshot(value); setStatus("loadStatus", "Snapshot loaded from the registry.", true); }
  catch (error) { setStatus("loadStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("verify").addEventListener("click", async () => {
  setStatus("verifyStatus", "Verifying …");
  try {
    const c = connection();
    if (!snapshot) throw new Error("Load a snapshot first.");
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC endpoint or registry changed. Reload the snapshot.");
    const latest = await selected.read(c);
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("A new snapshot was published. Reload it before verifying.");
    const account = el<HTMLInputElement>("account").value.trim();
    if (!account) throw new Error("Enter your customer ID.");
    const file = el<HTMLInputElement>("proof").files?.[0];
    if (!file || file.size > 1_000_000) throw new Error("Select a JSON file of at most 1 MB.");
    const expected = new Map<number, bigint>();
    document.querySelectorAll<HTMLInputElement>(".balance").forEach((input) => {
      const value = input.value.trim();
      if (value) { if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Balances must be non-negative whole numbers."); expected.set(Number(input.dataset.asset), BigInt(value)); }
    });
    if (!expected.size) throw new Error("Enter at least one balance from your own records.");
    const result = await selected.verify(c, snapshot, await file.text(), account, expected, el<HTMLInputElement>("secret").value.trim());
    setStatus("verifyStatus", result.message, result.valid);
  } catch (error) { setStatus("verifyStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("inspect").addEventListener("click", async () => {
  setStatus("inspectStatus", "Comparing …");
  try {
    if (!snapshot) throw new Error("Load a snapshot first.");
    const c = connection();
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC endpoint or registry changed. Reload the snapshot.");
    const file = el<HTMLInputElement>("artifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Select a JSON artifact of at most 2 MB.");
    const latest = await selected.read(c);
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("A new snapshot was published. Reload it before comparing.");
    setStatus("inspectStatus", inspectArtifact(selected.id, latest, await file.text()), true);
  } catch (error) { setStatus("inspectStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("publish").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("publish");
  button.disabled = true;
  setStatus("publishStatus", "Checking artifacts and wallet …");
  try {
    const c = connection();
    const file = el<HTMLInputElement>("nextArtifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Select a new JSON artifact of at most 2 MB.");
    const supplement = el<HTMLInputElement>("supplement").files?.[0];
    if (supplement && supplement.size > 2_000_000) throw new Error("The additional proof exceeds 2 MB.");
    const data = await publicationCall(selected.id, c, await file.text(), supplement, el<HTMLInputElement>("rounds").value);
    setStatus("publishStatus", "Waiting for wallet confirmation …");
    const hash = await submitWithWallet(c, data);
    setStatus("publishStatus", `Transaction submitted: ${hash}. Reload the snapshot once it is confirmed.`, true);
  } catch (error) { setStatus("publishStatus", error instanceof Error ? error.message : String(error), false); }
  finally { button.disabled = false; }
});
for (const [tabId, viewId, nextRole] of [["customerTab", "customerView", "customer"], ["companyTab", "companyView", "company"]] as const) {
  el<HTMLButtonElement>(tabId).addEventListener("click", () => {
    role = nextRole;
    el<HTMLElement>("customerView").hidden = role !== "customer";
    el<HTMLElement>("companyView").hidden = role !== "company";
    for (const id of ["customerTab", "companyTab"]) { const active = id === tabId; el<HTMLButtonElement>(id).classList.toggle("active", active); el<HTMLButtonElement>(id).setAttribute("aria-selected", String(active)); }
  });
}
renderSolutions();
