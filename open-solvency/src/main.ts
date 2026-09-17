import { isAddress } from "viem";
import { displayAmount, freshnessText, parseBalance } from "./amounts.ts";
import { renderPublicLedger } from "./merkleView.ts";
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
let stateVersion = 0;
const connections: Record<string, { rpc: string; registry: string }> = stored.connections ?? {};
if (stored.rpc && stored.registry && !connections[selected.id]) connections[selected.id] = { rpc: stored.rpc, registry: stored.registry };
let demoConnections: Record<string, { rpc: string; registry: string }> | undefined;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar"><div class="shell topbar-inner"><a class="wordmark" href="/">Open<span>Solvency</span></a><span class="top-note">Research prototype</span></div></header>
  <main class="shell">
    <div class="hero"><h1>Check a solvency snapshot</h1><p>Read the published reserves and verify that your balances are included.</p></div>
    <div class="role-switch" role="tablist" aria-label="View"><button id="customerTab" class="active" role="tab" aria-selected="true">For customers</button><button id="companyTab" role="tab" aria-selected="false">For companies</button></div>
    <section class="panel selector"><div class="section-heading"><div><span class="eyebrow">1. Method</span><h2>Select a proof method</h2></div></div><div id="solutions" class="solution-grid"></div><p id="disclosure" class="hint"></p><button id="demo" class="secondary" hidden>Use local demo</button></section>
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">2. Registry</span><h2>Load a snapshot</h2></div></div><div class="form-grid"><label>RPC endpoint<input id="rpc" type="url" placeholder="https://…" value="${escapeHtml(stored.rpc ?? "http://127.0.0.1:8545")}" /></label><label>Registry address<input id="registry" spellcheck="false" placeholder="0x…" value="${escapeHtml(stored.registry ?? "")}" /></label></div><div class="actions"><button id="load" class="primary">Load latest snapshot</button><span id="loadStatus" role="status"></span></div><div id="snapshot" class="snapshot" hidden></div><div id="publicLedger" class="public-ledger" hidden></div></section>
    <section id="customerView" class="panel"><div class="section-heading"><div><span class="eyebrow">3. Balances</span><h2>Verify my balances</h2></div><span class="pill">No wallet needed</span></div><p id="customerHelp" class="hint"></p><div class="form-grid"><label>Customer ID<input id="account" autocomplete="off" placeholder="e.g. customer-123" /></label><label>Private customer proof (.json)<input id="proof" type="file" accept=".json,application/json" /></label></div><label class="unit-mode">Amount units<select id="unitMode"><option value="human">Token amounts</option><option value="proof">Proof units (integers)</option></select></label><div id="balances" class="balances"></div><label id="secretLabel">Account secret<input id="secret" autocomplete="off" placeholder="ZK and KZG only" /></label><div class="actions"><button id="verify" class="primary">Verify proof</button><span id="verifyStatus" role="status"></span></div></section>
    <section id="companyView" class="panel" hidden><div class="section-heading"><div><span class="eyebrow">3. Publication</span><h2>Publish a snapshot</h2></div><span class="pill">Company wallet</span></div><p class="hint">Generate the proofs with the CLI, then select the files below to publish the next epoch. Use a wallet authorized by the registry. Keep customer bundles private.</p><ol id="publication" class="steps"></ol><div class="company-callout"><strong>Review the current epoch</strong><p id="companyCheck">Load the registry above to review its epoch and reserves.</p></div><div class="artifact"><label>Compare an already published artifact<input id="artifact" type="file" accept=".json,application/json" /></label><button id="inspect" class="secondary">Compare with registry</button><p id="inspectStatus" role="status" class="hint"></p></div><div class="publish"><h3>Submit the next epoch</h3><div class="form-grid"><label id="nextLabel">New artifact<input id="nextArtifact" type="file" accept=".json,application/json" /></label><label id="supplementLabel">Additional proof<input id="supplement" type="file" /></label></div><label id="roundsLabel">Oracle round IDs (three comma-separated values)<input id="rounds" placeholder="123, 456, 789" /></label><div class="actions"><button id="publish" class="primary">Publish with company wallet</button><span id="publishStatus" role="status"></span></div></div></section>
  </main><footer class="shell">A valid customer proof confirms inclusion in the published snapshot. It cannot reveal undisclosed liabilities or lock reserves.</footer>`;

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function setStatus(id: string, message: string, ok?: boolean) { const node = el<HTMLElement>(id); node.textContent = message; node.className = ok === undefined ? "" : ok ? "good" : "error"; }
function renderSolutions() {
  el<HTMLDivElement>("solutions").innerHTML = solutions.map((s, i) => `<button class="solution ${s.id === selected.id ? "selected" : ""}" data-id="${s.id}" aria-pressed="${s.id === selected.id}"><span class="solution-number">0${i + 1}</span><strong>${s.name}</strong><small>${s.description}</small></button>`).join("");
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
  document.querySelectorAll<HTMLButtonElement>(".solution").forEach((button) => button.addEventListener("click", () => {
    save();
    selected = solutions.find((s) => s.id === button.dataset.id as SolutionId)!;
    restoreConnection();
    invalidate();
    el<HTMLInputElement>("proof").value = "";
    el<HTMLInputElement>("artifact").value = "";
    el<HTMLInputElement>("nextArtifact").value = "";
    el<HTMLInputElement>("supplement").value = "";
    setStatus("loadStatus", "Method changed. Reload the snapshot.");
    el<HTMLInputElement>("secret").value = "";
    renderSolutions();
    save();
  }));
}
function renderBalances() {
  const count = snapshot?.assets.length ?? (selected.id === "zk-circuit" ? 3 : 1);
  el<HTMLElement>("balances").innerHTML = Array.from({ length: count }, (_, i) => {
    const asset = snapshot?.assets[i];
    const known = asset?.unitDecimals !== undefined;
    const human = el<HTMLSelectElement>("unitMode").value === "human" && known;
    const hint = known ? `1 ${asset!.label} = ${10n ** BigInt(asset!.unitDecimals!)} proof units` : `${asset?.unitDescription ?? "Token metadata unavailable"}. Enter integer proof units.`;
    return `<label>${escapeHtml(asset?.label ?? `Asset ${i}`)} · ${human ? "Token amount" : "Proof units"}<input class="balance" data-asset="${i}" inputmode="decimal" placeholder="${human && asset!.unitDecimals! > 0 ? "e.g. 2.5" : "0"}" /><small>${escapeHtml(hint)}</small><small id="amount-${i}" role="status"></small></label>`;
  }).join("");
  document.querySelectorAll<HTMLInputElement>(".balance").forEach(input => input.addEventListener("input", () => {
    const asset = snapshot?.assets[Number(input.dataset.asset)];
    try {
      const amount = input.value ? parseBalance(input.value.trim(), el<HTMLSelectElement>("unitMode").value === "human" ? asset?.unitDecimals ?? 0 : 0) : undefined;
      el<HTMLElement>(`amount-${input.dataset.asset}`).textContent = amount !== undefined && asset ? `${amount} proof units = ${displayAmount(amount, asset)}` : "";
    } catch (error) { el<HTMLElement>(`amount-${input.dataset.asset}`).textContent = error instanceof Error ? error.message : String(error); }
  }));
}
function save() {
  connections[selected.id] = { rpc: el<HTMLInputElement>("rpc").value.trim(), registry: el<HTMLInputElement>("registry").value.trim() };
  try { localStorage.setItem("opensolvency.settings", JSON.stringify({ solution: selected.id, connections })); } catch { /* storage optional */ }
}
function restoreConnection() {
  const value = connections[selected.id] ?? { rpc: `http://127.0.0.1:${{ "published-ledger": 8545, "zk-circuit": 8546, snarkless: 8547 }[selected.id]}`, registry: "" };
  el<HTMLInputElement>("rpc").value = value.rpc;
  el<HTMLInputElement>("registry").value = value.registry;
}
function invalidate() {
  stateVersion++;
  snapshot = null;
  snapshotConnection = null;
  el<HTMLElement>("snapshot").hidden = true;
  el<HTMLElement>("publicLedger").hidden = true;
  for (const id of ["verifyStatus", "inspectStatus", "publishStatus"]) setStatus(id, "");
  el<HTMLElement>("companyCheck").textContent = "Load the registry above to review its epoch and reserves.";
}
function showFreshness(value: Snapshot) {
  const node = el<HTMLElement>("freshness");
  node.textContent = freshnessText(value.freshness);
  node.className = value.freshness?.current ? "good" : "warning";
}
function connection(): Connection {
  const rpc = el<HTMLInputElement>("rpc").value.trim();
  const registry = el<HTMLInputElement>("registry").value.trim();
  if (!/^https?:\/\//.test(rpc)) throw new Error("Enter an HTTP(S) RPC endpoint.");
  if (!isAddress(registry)) throw new Error("Enter a valid registry address.");
  return { rpc, registry };
}
function renderSnapshot(value: Snapshot) {
  const amount = (raw: bigint | undefined, asset: Snapshot["assets"][number]) => raw === undefined ? "private" : `${escapeHtml(displayAmount(raw, asset))}<small>${raw} proof units</small>`;
  const rows = value.assets.map((asset, i) => `<tr><td>${escapeHtml(asset.label)}<small>Asset ${i}</small><small class="token-address">${escapeHtml(asset.token ?? "")}</small></td><td>${amount(asset.reserves, asset)}</td><td>${amount(asset.liabilities, asset)}</td><td>${asset.floor === undefined ? "—" : amount(asset.floor, asset)}</td></tr>`).join("");
  const panel = el<HTMLElement>("snapshot");
  panel.innerHTML = `<p id="freshness" role="status"></p><div class="snapshot-meta"><div><span>Epoch</span><strong>${value.epoch}</strong></div><div><span>Published</span><strong>${new Date(Number(value.timestamp) * 1000).toLocaleString("en-GB")}</strong></div></div><div class="commitment"><span>Commitment / snapshot ID</span><code>${escapeHtml(value.commitment)}</code></div><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Reserves</th><th>Liabilities</th><th>Reserve floor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  panel.hidden = false;
  showFreshness(value);
  el<HTMLElement>("companyCheck").textContent = `Current snapshot: epoch ${value.epoch}, published ${new Date(Number(value.timestamp) * 1000).toLocaleString("en-GB")}. Compare these figures with your internal records before creating a new proof.`;
  renderBalances();
  const publicLedger = el<HTMLElement>("publicLedger");
  publicLedger.hidden = selected.id !== "published-ledger";
  if (selected.id === "published-ledger" && value.publicLedger) {
    renderPublicLedger(publicLedger, value.publicLedger, value.assets.map(asset => asset.label), (raw, assetId) => displayAmount(raw, value.assets[assetId]));
  }
}
el<HTMLButtonElement>("load").addEventListener("click", async () => {
  snapshot = null;
  el<HTMLElement>("snapshot").hidden = true;
  setStatus("loadStatus", "Reading the smart contract …");
  const version = stateVersion;
  const solution = selected;
  try { const c = connection(); const value = await solution.read(c); if (version !== stateVersion) return; snapshot = value; snapshotConnection = `${c.rpc}|${c.registry.toLowerCase()}`; save(); renderSnapshot(value); setStatus("loadStatus", "Snapshot loaded from the registry.", true); }
  catch (error) { if (version === stateVersion) setStatus("loadStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("verify").addEventListener("click", async () => {
  setStatus("verifyStatus", "Verifying …");
  const version = stateVersion;
  const solution = selected;
  try {
    const c = connection();
    if (!snapshot) throw new Error("Load a snapshot first.");
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC endpoint or registry changed. Reload the snapshot.");
    const latest = await solution.read(c);
    if (version !== stateVersion) return;
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("A new snapshot was published. Reload it before verifying.");
    const account = el<HTMLInputElement>("account").value.trim();
    if (!account) throw new Error("Enter your customer ID.");
    const file = el<HTMLInputElement>("proof").files?.[0];
    if (!file || file.size > 1_000_000) throw new Error("Select a JSON file of at most 1 MB.");
    const expected = new Map<number, bigint>();
    document.querySelectorAll<HTMLInputElement>(".balance").forEach((input) => {
      const value = input.value.trim();
      if (value) {
        const id = Number(input.dataset.asset);
        const decimals = el<HTMLSelectElement>("unitMode").value === "human" ? snapshot!.assets[id]?.unitDecimals ?? 0 : 0;
        expected.set(id, parseBalance(value, decimals));
      }
    });
    if (!expected.size) throw new Error("Enter at least one balance from your own records.");
    const result = await solution.verify(c, snapshot, await file.text(), account, expected, el<HTMLInputElement>("secret").value.trim());
    if (version !== stateVersion) return;
    showFreshness(latest);
    setStatus("verifyStatus", result.message, result.valid);
    if (result.valid && !latest.freshness?.current) {
      setStatus("verifyStatus", `${result.message} This snapshot has expired or its freshness is unavailable. Ask the company for a newer snapshot.`);
      el<HTMLElement>("verifyStatus").className = "warning";
    }
  } catch (error) { if (version === stateVersion) setStatus("verifyStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("inspect").addEventListener("click", async () => {
  setStatus("inspectStatus", "Comparing …");
  const version = stateVersion;
  const solution = selected;
  try {
    if (!snapshot) throw new Error("Load a snapshot first.");
    const c = connection();
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC endpoint or registry changed. Reload the snapshot.");
    const file = el<HTMLInputElement>("artifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Select a JSON artifact of at most 2 MB.");
    const latest = await solution.read(c);
    if (version !== stateVersion) return;
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("A new snapshot was published. Reload it before comparing.");
    if (version !== stateVersion) return;
    showFreshness(latest);
    setStatus("inspectStatus", inspectArtifact(solution.id, latest, await file.text()), true);
  } catch (error) { if (version === stateVersion) setStatus("inspectStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("publish").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("publish");
  button.disabled = true;
  setStatus("publishStatus", "Checking artifacts and wallet …");
  const version = stateVersion;
  const solution = selected;
  try {
    const c = connection();
    const file = el<HTMLInputElement>("nextArtifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Select a new JSON artifact of at most 2 MB.");
    const supplement = el<HTMLInputElement>("supplement").files?.[0];
    if (supplement && supplement.size > 2_000_000) throw new Error("The additional proof exceeds 2 MB.");
    const data = await publicationCall(solution.id, c, await file.text(), supplement, el<HTMLInputElement>("rounds").value);
    if (version !== stateVersion) return;
    setStatus("publishStatus", "Waiting for wallet confirmation …");
    const hash = await submitWithWallet(c, data);
    if (version !== stateVersion) return;
    setStatus("publishStatus", `Transaction submitted: ${hash}. Reload the snapshot once it is confirmed.`, true);
  } catch (error) { if (version === stateVersion) setStatus("publishStatus", error instanceof Error ? error.message : String(error), false); }
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
restoreConnection();
renderSolutions();
el<HTMLSelectElement>("unitMode").addEventListener("change", () => { renderBalances(); setStatus("verifyStatus", "Amount units changed. Re-enter balances from your records."); });
for (const id of ["rpc", "registry"]) el<HTMLInputElement>(id).addEventListener("input", () => {
  invalidate(); renderBalances(); setStatus("loadStatus", "Connection changed. Load a snapshot.");
});
el<HTMLButtonElement>("demo").addEventListener("click", () => {
  if (!demoConnections) return;
  Object.assign(connections, demoConnections);
  restoreConnection(); invalidate(); save();
  el<HTMLButtonElement>("load").click();
});
void fetch("/demo-config.json").then(async response => {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
  const config = await response.json();
  if (config.version !== 1 || !solutions.every(s => /^https?:\/\//.test(config.solutions?.[s.id]?.rpc ?? "") && isAddress(config.solutions?.[s.id]?.registry ?? ""))) return;
  demoConnections = config.solutions;
  el<HTMLElement>("demo").hidden = false;
}).catch(() => { /* A standalone website has no local demo configuration. */ });
