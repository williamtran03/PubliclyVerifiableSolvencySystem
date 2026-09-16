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
  <header class="topbar"><div class="shell topbar-inner"><a class="wordmark" href="/">Open<span>Solvency</span></a><span class="top-note">Verifizierbare Solvenz · Demo-Oberfläche</span></div></header>
  <main class="shell">
    <div class="hero"><span class="eyebrow">Eine Oberfläche. Drei Nachweisverfahren.</span><h1>Solvenz nachvollziehbar machen.</h1><p>Wähle das Verfahren und prüfe einen veröffentlichten Snapshot direkt am Smart Contract.</p></div>
    <div class="role-switch" role="tablist" aria-label="Ansicht"><button id="customerTab" class="active" role="tab" aria-selected="true">Für Kunden</button><button id="companyTab" role="tab" aria-selected="false">Für Unternehmen</button></div>
    <section class="panel selector"><div class="section-heading"><div><span class="eyebrow">01 · Verfahren</span><h2>Nachweis auswählen</h2></div><span class="pill">Modular</span></div><div id="solutions" class="solution-grid"></div><p id="disclosure" class="hint"></p></section>
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">02 · Blockchain</span><h2>Snapshot laden</h2></div></div><div class="form-grid"><label>RPC-Endpunkt<input id="rpc" type="url" placeholder="https://…" value="${escapeHtml(stored.rpc ?? "http://127.0.0.1:8545")}" /></label><label>Register-Adresse<input id="registry" spellcheck="false" placeholder="0x…" value="${escapeHtml(stored.registry ?? "")}" /></label></div><div class="actions"><button id="load" class="primary">Aktuellen Snapshot laden</button><span id="loadStatus" role="status"></span></div><div id="snapshot" class="snapshot" hidden></div></section>
    <section id="customerView" class="panel"><div class="section-heading"><div><span class="eyebrow">03 · Kundenprüfung</span><h2>Mein Guthaben prüfen</h2></div><span class="pill">Ohne Wallet</span></div><p id="customerHelp" class="hint"></p><div class="form-grid"><label>Kunden-ID<input id="account" autocomplete="off" placeholder="z. B. customer-123" /></label><label>Privater Kunden-Proof (.json)<input id="proof" type="file" accept=".json,application/json" /></label></div><div id="balances" class="balances"></div><label id="secretLabel">Account-Secret<input id="secret" autocomplete="off" placeholder="Nur für ZK und KZG" /></label><div class="actions"><button id="verify" class="primary">Proof prüfen</button><span id="verifyStatus" role="status"></span></div></section>
    <section id="companyView" class="panel" hidden><div class="section-heading"><div><span class="eyebrow">03 · Unternehmensablauf</span><h2>Snapshot veröffentlichen</h2></div><span class="pill">Company-Wallet</span></div><p class="hint">Die Proofs werden mit den vorhandenen CLI-Werkzeugen erzeugt. Lade die Artefakte hier lokal und veröffentliche den nächsten Epoch mit der autorisierten Company-Wallet. Keine privaten Kunden-Bundles in die Webseite oder ein öffentliches Web-Build legen.</p><ol id="publication" class="steps"></ol><div class="company-callout"><strong>Aktuellen Epoch prüfen</strong><p id="companyCheck">Lade oben das Register, um Epoch und Reserven zu kontrollieren.</p></div><div class="artifact"><label>Bereits veröffentlichtes Artefakt vergleichen<input id="artifact" type="file" accept=".json,application/json" /></label><button id="inspect" class="secondary">Mit Register vergleichen</button><p id="inspectStatus" role="status" class="hint"></p></div><div class="publish"><h3>Nächsten Epoch senden</h3><div class="form-grid"><label id="nextLabel">Neues Artefakt<input id="nextArtifact" type="file" accept=".json,application/json" /></label><label id="supplementLabel">Zusätzlicher Proof<input id="supplement" type="file" /></label></div><label id="roundsLabel">Oracle-Round-IDs (drei Werte, Komma getrennt)<input id="rounds" placeholder="123, 456, 789" /></label><div class="actions"><button id="publish" class="primary">Mit Company-Wallet veröffentlichen</button><span id="publishStatus" role="status"></span></div></div></section>
  </main><footer class="shell">Ein gültiger Kunden-Proof belegt die Einbeziehung in den veröffentlichten Snapshot. Er entdeckt keine verschwiegenen Verbindlichkeiten und sperrt keine Reserven.</footer>`;

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function setStatus(id: string, message: string, ok?: boolean) { const node = el<HTMLElement>(id); node.textContent = message; node.className = ok === undefined ? "" : ok ? "good" : "error"; }
function renderSolutions() {
  el<HTMLDivElement>("solutions").innerHTML = solutions.map((s, i) => `<button class="solution ${s.id === selected.id ? "selected" : ""}" data-id="${s.id}" aria-pressed="${s.id === selected.id}"><span class="solution-number">0${i + 1}</span><strong>${s.name}</strong><small>${s.description}</small></button>`).join("");
  el<HTMLElement>("disclosure").textContent = selected.disclosure;
  el<HTMLElement>("customerHelp").textContent = selected.id === "snarkless"
    ? "Nimm den Betrag aus deinen Unterlagen. Die JSON-Datei bleibt lokal; KZG sendet Identitäts-Commitment, Betrag und Öffnung für verifyInclusion an deinen RPC-Endpunkt."
    : "Nimm deine Beträge aus eigenen Unterlagen. Die JSON-Datei und dein Secret bleiben bei der lokalen Prüfung im Browser.";
  el<HTMLOListElement>("publication").innerHTML = selected.publication.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  el<HTMLElement>("secretLabel").hidden = selected.id === "published-ledger";
  el<HTMLElement>("supplementLabel").hidden = selected.id === "published-ledger";
  el<HTMLElement>("roundsLabel").hidden = selected.id !== "zk-circuit";
  el<HTMLElement>("nextLabel").firstChild!.textContent = selected.id === "published-ledger" ? "Neuer öffentlicher Ledger (ledger.json)" : "Neues Epoch-Artefakt (epoch.json)";
  el<HTMLElement>("supplementLabel").firstChild!.textContent = selected.id === "snarkless" ? "Range-Proof (range-proof.json)" : "ZK-Proof (proof.bin)";
  renderBalances();
  document.querySelectorAll<HTMLButtonElement>(".solution").forEach((button) => button.addEventListener("click", () => {
    selected = solutions.find((s) => s.id === button.dataset.id as SolutionId)!;
    snapshot = null;
    snapshotConnection = null;
    el<HTMLElement>("snapshot").hidden = true;
    el<HTMLInputElement>("proof").value = "";
    el<HTMLInputElement>("artifact").value = "";
    el<HTMLInputElement>("nextArtifact").value = "";
    el<HTMLInputElement>("supplement").value = "";
    setStatus("loadStatus", "Verfahren gewechselt. Snapshot erneut laden.");
    setStatus("verifyStatus", "");
    renderSolutions();
    save();
  }));
}
function renderBalances() {
  const count = snapshot?.assets.length ?? (selected.id === "zk-circuit" ? 3 : 1);
  el<HTMLElement>("balances").innerHTML = Array.from({ length: count }, (_, i) => `<label>${escapeHtml(snapshot?.assets[i]?.label ?? `Asset ${i}`)} · Betrag in Basiseinheiten<input class="balance" data-asset="${i}" inputmode="numeric" placeholder="0" /></label>`).join("");
}
function save() {
  try { localStorage.setItem("opensolvency.settings", JSON.stringify({ solution: selected.id, rpc: el<HTMLInputElement>("rpc").value.trim(), registry: el<HTMLInputElement>("registry").value.trim() })); } catch { /* storage optional */ }
}
function connection(): Connection {
  const rpc = el<HTMLInputElement>("rpc").value.trim();
  const registry = el<HTMLInputElement>("registry").value.trim();
  if (!/^https?:\/\//.test(rpc)) throw new Error("Bitte einen HTTP(S)-RPC-Endpunkt eingeben.");
  if (!isAddress(registry)) throw new Error("Bitte eine gültige Register-Adresse eingeben.");
  return { rpc, registry };
}
function renderSnapshot(value: Snapshot) {
  const rows = value.assets.map((asset) => `<tr><td>${escapeHtml(asset.label)}</td><td>${asset.reserves}</td><td>${asset.liabilities ?? "privat"}</td><td>${asset.floor ?? "—"}</td></tr>`).join("");
  const panel = el<HTMLElement>("snapshot");
  panel.innerHTML = `<div class="snapshot-meta"><div><span>Epoch</span><strong>${value.epoch}</strong></div><div><span>Veröffentlicht</span><strong>${new Date(Number(value.timestamp) * 1000).toLocaleString("de-CH")}</strong></div></div><div class="commitment"><span>Commitment / Snapshot-ID</span><code>${escapeHtml(value.commitment)}</code></div><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Reserven</th><th>Verbindlichkeiten</th><th>Untergrenze</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  panel.hidden = false;
  el<HTMLElement>("companyCheck").textContent = `Aktueller Snapshot: Epoch ${value.epoch}, veröffentlicht ${new Date(Number(value.timestamp) * 1000).toLocaleString("de-CH")}. Prüfe die Zahlen vor dem Erstellen eines neuen Proofs gegen deine internen Daten.`;
  renderBalances();
}
el<HTMLButtonElement>("load").addEventListener("click", async () => {
  snapshot = null;
  el<HTMLElement>("snapshot").hidden = true;
  setStatus("loadStatus", "Lese Smart Contract …");
  try { const c = connection(); const value = await selected.read(c); snapshot = value; snapshotConnection = `${c.rpc}|${c.registry.toLowerCase()}`; save(); renderSnapshot(value); setStatus("loadStatus", "Snapshot aus dem Register geladen.", true); }
  catch (error) { setStatus("loadStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("verify").addEventListener("click", async () => {
  setStatus("verifyStatus", "Prüfe …");
  try {
    const c = connection();
    if (!snapshot) throw new Error("Zuerst einen Snapshot laden.");
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC oder Register wurde geändert. Snapshot erneut laden.");
    const latest = await selected.read(c);
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("Ein neuer Snapshot wurde veröffentlicht. Bitte erneut laden.");
    const account = el<HTMLInputElement>("account").value.trim();
    if (!account) throw new Error("Bitte Kunden-ID eingeben.");
    const file = el<HTMLInputElement>("proof").files?.[0];
    if (!file || file.size > 1_000_000) throw new Error("Bitte eine JSON-Datei bis 1 MB auswählen.");
    const expected = new Map<number, bigint>();
    document.querySelectorAll<HTMLInputElement>(".balance").forEach((input) => {
      const value = input.value.trim();
      if (value) { if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Guthaben müssen nichtnegative ganze Zahlen sein."); expected.set(Number(input.dataset.asset), BigInt(value)); }
    });
    if (!expected.size) throw new Error("Bitte mindestens ein Guthaben aus deinen Unterlagen eingeben.");
    const result = await selected.verify(c, snapshot, await file.text(), account, expected, el<HTMLInputElement>("secret").value.trim());
    setStatus("verifyStatus", result.message, result.valid);
  } catch (error) { setStatus("verifyStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("inspect").addEventListener("click", async () => {
  setStatus("inspectStatus", "Vergleiche …");
  try {
    if (!snapshot) throw new Error("Zuerst einen Snapshot laden.");
    const c = connection();
    if (snapshotConnection !== `${c.rpc}|${c.registry.toLowerCase()}`) throw new Error("RPC oder Register wurde geändert. Snapshot erneut laden.");
    const file = el<HTMLInputElement>("artifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Bitte ein JSON-Artefakt bis 2 MB auswählen.");
    const latest = await selected.read(c);
    if (latest.epoch !== snapshot.epoch || latest.commitment !== snapshot.commitment) throw new Error("Ein neuer Snapshot wurde veröffentlicht. Bitte erneut laden.");
    setStatus("inspectStatus", inspectArtifact(selected.id, latest, await file.text()), true);
  } catch (error) { setStatus("inspectStatus", error instanceof Error ? error.message : String(error), false); }
});
el<HTMLButtonElement>("publish").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("publish");
  button.disabled = true;
  setStatus("publishStatus", "Prüfe Artefakte und Wallet …");
  try {
    const c = connection();
    const file = el<HTMLInputElement>("nextArtifact").files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("Bitte ein neues JSON-Artefakt bis 2 MB auswählen.");
    const supplement = el<HTMLInputElement>("supplement").files?.[0];
    if (supplement && supplement.size > 2_000_000) throw new Error("Zusätzlicher Proof ist zu groß.");
    const data = await publicationCall(selected.id, c, await file.text(), supplement, el<HTMLInputElement>("rounds").value);
    setStatus("publishStatus", "Wallet-Bestätigung ausstehend …");
    const hash = await submitWithWallet(c, data);
    setStatus("publishStatus", `Transaktion gesendet: ${hash}. Nach Bestätigung Snapshot neu laden.`, true);
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
