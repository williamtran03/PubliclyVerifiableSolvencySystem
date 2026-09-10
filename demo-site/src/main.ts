import { $, ASSET_NAMES, loadSettings, readEpoch, saveSettings, usd } from "./chain.ts";

const settings = loadSettings();
$<HTMLInputElement>("#rpcUrl").value = settings.rpcUrl;
$<HTMLInputElement>("#registry").value = settings.registry;

async function load() {
  const next = {
    rpcUrl: $<HTMLInputElement>("#rpcUrl").value.trim(),
    registry: $<HTMLInputElement>("#registry").value.trim(),
  };
  const status = $<HTMLParagraphElement>("#loadStatus");
  const error = $<HTMLDivElement>("#loadError");
  status.textContent = "Reading from chain…";
  error.hidden = true;

  try {
    const epoch = await readEpoch(next);
    saveSettings(next);

    const solvent = epoch.assetsUsd >= epoch.liabilitiesUsd;
    $("#verdictDot").className = `dot ${solvent ? "ok" : "bad"}`;
    $("#verdict").textContent = solvent ? "Fully backed" : "Not fully backed";
    $("#timestamp").textContent = `Last published ${new Date(
      Number(epoch.timestamp) * 1000,
    ).toLocaleString()}`;

    $("#assetsUsd").textContent = usd(epoch.assetsUsd);
    $("#liabilitiesUsd").textContent = usd(epoch.liabilitiesUsd);
    $("#surplusUsd").textContent = usd(epoch.assetsUsd - epoch.liabilitiesUsd);
    $("#coverage").textContent = epoch.liabilitiesUsd === 0n
      ? "—"
      : `${(Number(epoch.assetsUsd) / Number(epoch.liabilitiesUsd) * 100).toFixed(1)}%`;

    $("#priceRows").innerHTML = epoch.prices
      .map(
        (price, i) =>
          `<tr><td>${ASSET_NAMES[i]}</td><td>${usd(price)}</td><td class="muted">#${epoch.roundIds[i]}</td></tr>`,
      )
      .join("");

    $("#rootHash").textContent = `0x${epoch.rootHash.toString(16).padStart(64, "0")}`;

    for (const id of ["#summary", "#tableCard", "#commitmentCard"]) $(id).hidden = false;
    status.textContent = "Up to date.";
  } catch (cause) {
    for (const id of ["#summary", "#tableCard", "#commitmentCard"]) $(id).hidden = true;
    status.textContent = "";
    error.hidden = false;
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

$<HTMLButtonElement>("#reloadBtn").addEventListener("click", load);
if (settings.registry) load();
