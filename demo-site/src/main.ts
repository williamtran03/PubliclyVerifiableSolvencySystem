import { createPublicClient, http, parseAbi } from "viem";
import { deserializeBundle, verifyBundle } from "@prover/multiAssetTree.ts";

const ASSET_NAMES = ["BTC", "ETH", "USDC"];

const registryAbi = parseAbi([
  "function currentEpoch() view returns (uint256 rootHash, uint256 liabilitiesUsd, uint256 assetsUsd, uint64 timestamp)",
  "function epochPrices(uint256) view returns (uint256)",
  "function epochRoundIds(uint256) view returns (uint80)",
]);

type CustomerIndex = { username: string; holdings: { assetId: number; amount: string }[] }[];

let epoch: { rootHash: bigint; liabilitiesUsd: bigint; assetsUsd: bigint } | null = null;
let customers: CustomerIndex = [];

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;
const usd = (value: bigint) => `$${value.toLocaleString("en-US")}`;

$<HTMLButtonElement>("#loadBtn").addEventListener("click", async () => {
  const status = $<HTMLDivElement>("#loadStatus");
  status.className = "status";
  status.textContent = "Reading currentEpoch() and readPrices()…";

  try {
    const client = createPublicClient({ transport: http($<HTMLInputElement>("#rpcUrl").value) });
    const address = $<HTMLInputElement>("#registryAddress").value.trim() as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Enter a valid registry address.");

    const read = (functionName: "epochPrices" | "epochRoundIds", i: number) =>
      client.readContract({ address, abi: registryAbi, functionName, args: [BigInt(i)] });

    const [current, ...table] = await Promise.all([
      client.readContract({ address, abi: registryAbi, functionName: "currentEpoch" }),
      ...ASSET_NAMES.map((_, i) => read("epochPrices", i)),
      ...ASSET_NAMES.map((_, i) => read("epochRoundIds", i)),
    ]);
    const prices = table.slice(0, ASSET_NAMES.length) as bigint[];
    const roundIds = table.slice(ASSET_NAMES.length) as bigint[];

    const [rootHash, liabilitiesUsd, assetsUsd, timestamp] = current;
    if (rootHash === 0n) throw new Error("No epoch has been published on this registry yet.");
    epoch = { rootHash, liabilitiesUsd, assetsUsd };

    const solvent = assetsUsd >= liabilitiesUsd;
    const verdict = $<HTMLDivElement>("#verdict");
    verdict.className = `verdict ${solvent ? "ok" : "bad"}`;
    verdict.textContent = solvent
      ? "Solvent — reserves cover all customer liabilities"
      : "NOT SOLVENT — reserves do not cover liabilities";

    $("#assetsUsd").textContent = usd(assetsUsd);
    $("#liabilitiesUsd").textContent = usd(liabilitiesUsd);
    $("#surplusUsd").textContent = usd(assetsUsd - liabilitiesUsd);
    $("#rootHash").textContent = `0x${rootHash.toString(16).padStart(64, "0")}`;
    $("#timestamp").textContent = `Published ${new Date(Number(timestamp) * 1000).toLocaleString()}`;

    $("#priceTable").querySelector("tbody")!.innerHTML = prices
      .map((price, i) => `<tr><td>${ASSET_NAMES[i]}</td><td>${usd(price)}</td><td>#${roundIds[i]}</td></tr>`)
      .join("");

    customers = await fetch("/bundles/index.json").then((r) => r.json());
    const select = $<HTMLSelectElement>("#customerSelect");
    select.innerHTML = customers.map((c) => `<option>${c.username}</option>`).join("");
    renderHoldings();

    $("#epochCard").hidden = false;
    $("#customerCard").hidden = false;
    status.className = "status ok";
    status.textContent = "Loaded from chain.";
  } catch (error) {
    epoch = null;
    $("#epochCard").hidden = true;
    $("#customerCard").hidden = true;
    status.className = "status bad";
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

function renderHoldings() {
  const customer = customers.find((c) => c.username === $<HTMLSelectElement>("#customerSelect").value);
  $("#holdingInputs").innerHTML = (customer?.holdings ?? [])
    .map(
      (h) =>
        `<label>${ASSET_NAMES[h.assetId]} amount
           <input class="expected" data-asset="${h.assetId}" value="${h.amount}" />
         </label>`,
    )
    .join("");
  $("#verifyResult").textContent = "";
}

$<HTMLSelectElement>("#customerSelect").addEventListener("change", renderHoldings);

$<HTMLButtonElement>("#verifyBtn").addEventListener("click", async () => {
  const result = $<HTMLDivElement>("#verifyResult");
  result.className = "status";
  result.textContent = "Recomputing the commitment from your proof…";

  try {
    if (!epoch) throw new Error("Load the published epoch first.");
    const username = $<HTMLSelectElement>("#customerSelect").value;

    const expected = new Map<number, bigint>();
    for (const input of document.querySelectorAll<HTMLInputElement>(".expected")) {
      const value = input.value.trim();
      if (!/^\d+$/.test(value)) throw new Error("Amounts must be whole numbers.");
      expected.set(Number(input.dataset.asset), BigInt(value));
    }

    const bundle = deserializeBundle(await fetch(`/bundles/${username}.json`).then((r) => r.text()));
    const valid = verifyBundle(bundle, expected, epoch.rootHash, epoch.liabilitiesUsd);

    result.className = `status ${valid ? "ok" : "bad"}`;
    result.textContent = valid
      ? "VALID — these balances are included in the commitment published on-chain, and are counted in the liabilities total the reserves were checked against."
      : "INVALID — this proof does not reconstruct the published commitment for the amounts entered.";
  } catch (error) {
    result.className = "status bad";
    result.textContent = error instanceof Error ? error.message : String(error);
  }
});
