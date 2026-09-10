import { publicSummary, exchangeRateRows, checkPublicCalculation, usd, coverage, type PublicSnapshot } from "./minimumClient.ts";
import { stringify } from "../../prover/minimum/tree.ts";
import { connectionPanel, markNavigation, output, element, button, loadState } from "./shared.ts";

markNavigation();
const connection = connectionPanel(() => {
  generation++;
  snapshot = undefined;
  clearClaimDetails();
  button("auditLedger").disabled = true;
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

button("auditLedger").onclick = async () => {
  try {
    const client = connection();
    const s = await client.current();
    output("ledgerResult", "Recomputing…");
    const ledger = await client.ledger(s.claim.snapshotId, s.claim.rootHash, s.claim.totalLiabilitiesUsd, s.capacity);
    if (!checkPublicCalculation(s)) throw Error("Manifest or USD arithmetic mismatch");
    output(
      "ledgerResult",
      `VALID public ledger: ${ledger.pairs.length} real parts, ${ledger.capacity} capacity. Root, total and asset conversions match.\n${stringify(ledger)}`,
    );
  } catch (e) {
    output("ledgerResult", `ERROR: ${e instanceof Error ? e.message : e}`);
  }
};
