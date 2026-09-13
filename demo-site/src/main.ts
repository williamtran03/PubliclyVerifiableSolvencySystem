import { $, ASSET_NAMES, hex, loadSettings, readEpoch, saveSettings, usd } from "./chain.ts";

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

    $("#verdictDot").className = "dot ok";
    $("#verdict").textContent = "Fully backed, asset by asset";
    $("#timestamp").textContent = `Epoch ${epoch.epochId} · published ${new Date(
      Number(epoch.timestamp) * 1000,
    ).toLocaleString()}`;

    $("#assetsUsd").textContent = usd(epoch.assetsUsd);
    $("#epochId").textContent = epoch.epochId.toString();
    $("#covered").textContent = `${ASSET_NAMES.length} of ${ASSET_NAMES.length}`;

    $("#assetRows").innerHTML = ASSET_NAMES.map(
      (name, i) =>
        `<tr><td>${name}</td><td>${epoch.reserveUnits[i]}</td><td>${epoch.floors[i]}</td>` +
        `<td>${usd(epoch.prices[i])}</td><td class="muted">#${epoch.roundIds[i]}</td></tr>`,
    ).join("");

    $("#rootHash").textContent = hex(epoch.rootHash);

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
