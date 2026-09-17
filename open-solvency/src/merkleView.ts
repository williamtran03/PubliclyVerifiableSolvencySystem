import { buildTree, keccakHash, type Entry, type Node } from "@arms/published-ledger/prover/tree.ts";
import type { PublicLedgerAsset } from "./types.ts";

const short = (value: bigint) => {
  const text = value.toString(16).padStart(64, "0");
  return `0x${text.slice(0, 10)}…${text.slice(-8)}`;
};

function treeSvg(levels: Node[][], assetLabel: string): SVGSVGElement {
  const width = 900;
  const rowHeight = 44;
  const height = levels.length * rowHeight + 36;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "public-tree");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Public Merkle-sum tree for ${assetLabel}`);
  const element = (name: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const x = (level: number, index: number) => ((index + 0.5) * width) / levels[level].length;
  const y = (level: number) => height - 20 - level * rowHeight;
  for (let level = 0; level < levels.length - 1; level++) {
    for (let index = 0; index < levels[level].length; index++) {
      svg.append(element("line", { x1: x(level, index), y1: y(level), x2: x(level + 1, Math.floor(index / 2)), y2: y(level + 1), class: "public-tree-edge" }));
    }
  }
  for (let level = 0; level < levels.length; level++) {
    for (let index = 0; index < levels[level].length; index++) {
      const node = levels[level][index];
      svg.append(element("circle", { cx: x(level, index), cy: y(level), r: level === 0 ? 4 : 5, class: level === levels.length - 1 ? "public-tree-root" : "public-tree-node" }));
      if (levels[level].length <= 16 || level === levels.length - 1) {
        const label = element("text", { x: x(level, index), y: y(level) - 9, class: "public-tree-label", "text-anchor": "middle" });
        label.textContent = level === levels.length - 1 ? "root" : short(node.hash);
        svg.append(label);
      }
    }
  }
  return svg;
}

export function renderPublicLedger(target: HTMLElement, assets: PublicLedgerAsset[], labels: string[], format: (value: bigint, asset: number) => string) {
  target.replaceChildren();
  if (!assets.length) {
    target.innerHTML = "<p class=\"hint\">No public ledger transaction was found for this epoch.</p>";
    return;
  }
  const heading = document.createElement("p");
  heading.className = "hint";
  heading.textContent = "The submitted Merkle-sum ledger is public. Each row is a pseudonymous liability part; the tree below recomputes the published root and total for that asset.";
  target.append(heading);
  assets.forEach((asset, assetId) => {
    const entries: Entry[] = asset.entries.map(entry => ({ username: "", identityHash: entry.identity, balance: entry.amount }));
    const tree = buildTree(entries, keccakHash);
    const section = document.createElement("article");
    section.className = "public-ledger-asset";
    section.innerHTML = `<h3>${labels[assetId] ?? `Asset ${assetId}`}</h3><p class="hint">${asset.entries.length} public parts · total ${format(asset.total, assetId)} · root <code>${short(asset.rootHash)}</code></p>`;
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Part</th><th>Public identity commitment</th><th>Liability</th></tr></thead>";
    const body = document.createElement("tbody");
    asset.entries.forEach((entry, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${index + 1}</td><td><code>${short(entry.identity)}</code></td><td>${format(entry.amount, assetId)}</td>`;
      body.append(row);
    });
    table.append(body);
    section.append(table, treeSvg(tree.levels, labels[assetId] ?? `Asset ${assetId}`));
    target.append(section);
  });
}
