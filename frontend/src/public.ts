import { publicSummary, exchangeRateRows, checkPublicCalculation, usd, coverage, type PublicSnapshot } from "./minimumClient.ts";
import type { Ledger } from "../../prover/minimum/tree.ts";
import { stringify } from "../../prover/minimum/tree.ts";
import { connectionPanel, markNavigation, output, element, button, loadState } from "./shared.ts";

markNavigation();
const connection = connectionPanel(() => {
  generation++;
  snapshot = undefined;
  clearClaimDetails();
  button("auditLedger").disabled = true;
  button("downloadLedger").disabled = true;
  output("epochResult", "Connection changed; read the claim again.");
});
let snapshot: PublicSnapshot | undefined;
let generation = 0;

const claimValue = (label: string, text: string) => {
  const box = document.createElement("div");
  box.className = "claim-figure";
  const name = document.createElement("span");
  name.className = "claim-label";
  name.textContent = label;
  const figure = document.createElement("strong");
  figure.textContent = text;
  box.append(name, figure);
  return box;
};

/** Renders the headline verdict as figures. */
function renderClaim(s: PublicSnapshot) {
  const c = s.claim,
    solvent = c.totalEligibleAssetsUsd >= c.totalLiabilitiesUsd,
    root = element("epochResult");
  root.replaceChildren();
  root.classList.remove("boxed", "ok", "fail");
  const status = document.createElement("div");
  status.className = `claim-status ${solvent ? "is-solvent" : "is-insolvent"}`;
  const dot = document.createElement("span");
  dot.className = "claim-dot";
  const title = document.createElement("strong");
  title.textContent = solvent ? "SOLVENT" : "INSOLVENT";
  const when = document.createElement("span");
  when.textContent = `Published snapshot · ${new Date(Number(c.snapshotTime) * 1000).toLocaleString()}`;
  status.append(dot, title, when);
  const figures = document.createElement("div");
  figures.className = "claim-figures";
  figures.append(
    claimValue("Eligible assets", usd(c.totalEligibleAssetsUsd)),
    claimValue("Liabilities", usd(c.totalLiabilitiesUsd)),
    claimValue("Surplus / deficit", usd(c.totalEligibleAssetsUsd - c.totalLiabilitiesUsd)),
    claimValue("Coverage", coverage(c.totalEligibleAssetsUsd, c.totalLiabilitiesUsd)),
  );
  root.append(status, figures);
}

function clearClaimDetails() {
  for (const id of ["claimDetails", "reserveDetails", "ledgerResult"]) output(id, "");
  element("ledgerWrap").hidden = true;
  output("ledgerSummary", "Read the claim first, then load the ledger.");
  element("epochResult").classList.add("boxed");
  const body = element("rates");
  body.replaceChildren();
  const row = document.createElement("tr"),
    cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = "No exchange rates loaded.";
  row.append(cell);
  body.append(row);
}

function renderRates(s: PublicSnapshot) {
  const body = element("rates");
  body.replaceChildren();
  for (const values of exchangeRateRows(s)) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  if (!s.rates.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No exchange rates published.";
    row.append(cell);
    body.append(row);
  }
}

button("connectBtn").onclick = async () => {
  const version = ++generation;
  snapshot = undefined;
  clearClaimDetails();
  button("auditLedger").disabled = true;
  button("downloadLedger").disabled = true;
  output("epochResult", "Reading claim…");
  await loadState(
    () => connection().current(),
    (state) => {
      if (version !== generation) return;
      if (state.status === "loading") output("connection", "Reading contract…");
      else if (state.status === "error") {
        output("connection", `ERROR: ${state.error}`);
        output("epochResult", "No claim loaded.");
      } else {
        snapshot = state.value!;
        output("connection", "Connected. Values read at block " + snapshot.blockNumber);
        renderClaim(snapshot);
        output("claimDetails", publicSummary(snapshot));
        output("reserveDetails", stringify({ oracleRates: snapshot.rates, reserveObservations: snapshot.assets }));
        renderRates(snapshot);
        button("auditLedger").disabled = false;
      }
    },
  );
};

let ledger: Ledger | undefined;

function renderLedger(l: Ledger) {
  const body = element("ledgerTable");
  body.replaceChildren();
  let total = 0n;
  for (const [i, pair] of l.pairs.entries()) {
    total += pair.amount;
    const row = document.createElement("tr");
    for (const text of [String(i + 1), pair.identity, usd(pair.amount)]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
  }
  element("ledgerTotal").textContent = usd(total);
  element("ledgerWrap").hidden = false;
  return total;
}

button("auditLedger").onclick = async () => {
  button("auditLedger").disabled = true;
  output("ledgerSummary", "Reading the published ledger…");
  try {
    const client = connection();
    const s = await client.current();
    const loaded = await client.ledger(s.claim.snapshotId, s.claim.rootHash, s.claim.totalLiabilitiesUsd, s.capacity);
    if (!checkPublicCalculation(s)) throw Error("Manifest or USD arithmetic mismatch");
    const total = renderLedger(loaded);
    if (total !== s.claim.totalLiabilitiesUsd) throw Error("Ledger entries do not add up to the published total");
    ledger = loaded;
    button("downloadLedger").disabled = false;
    output(
      "ledgerSummary",
      `VALID: ${loaded.pairs.length} entries adding to ${usd(total)}, which is the total the reserves were checked against.\n` +
        `The ${loaded.capacity - loaded.pairs.length} unused slots are empty and hash to a fixed padding value.\n` +
        `Recomputed root ${loaded.rootHash} matches the root on chain.`,
    );
    output("ledgerResult", "");
  } catch (e) {
    element("ledgerWrap").hidden = true;
    output("ledgerSummary", `ERROR: ${e instanceof Error ? e.message : e}`);
  } finally {
    button("auditLedger").disabled = !snapshot;
  }
};

button("downloadLedger").onclick = () => {
  if (!ledger) return;
  const blob = new Blob([stringify(ledger)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ledger-${ledger.snapshotId.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
};
