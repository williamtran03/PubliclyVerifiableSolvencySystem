import { identity, pairNode, combine, type Bundle, type Part, type Node } from "../../prover/minimum/tree.ts";
import type { Hex } from "viem";

export type Step = { level: number; direction: 0 | 1; sibling: Node; result: Node };
/** The authentication path for one part, with every intermediate node kept for display. */
export type PartPath = { part: Part; leaf: Node; steps: Step[]; root: Node };

/** Recomputes the same walk `verify` performs, but records each intermediate node. */
export function partPath(bundle: Bundle, part: Part): PartPath {
  const leaf = pairNode(bundle.snapshotId, part.pairPosition, {
    identity: identity(bundle.snapshotId, bundle.customerId, bundle.dateOfBirth, part.partIndex, part.salt, part.nonce),
    amount: part.amount,
  });
  let node = leaf;
  const steps: Step[] = [];
  for (let level = 0; level < part.siblings.length; level++) {
    const direction = ((part.pairPosition >> level) & 1) as 0 | 1;
    node = direction ? combine(part.siblings[level], node) : combine(node, part.siblings[level]);
    steps.push({ level, direction, sibling: part.siblings[level], result: node });
  }
  return { part, leaf, steps, root: node };
}

export const paths = (bundle: Bundle) => bundle.parts.map((p) => partPath(bundle, p));
export const short = (h: Hex | string, head = 10, tail = 6) => `${h.slice(0, head)}…${h.slice(-tail)}`;
export const usd = (v: bigint) => `$${v / 100000000n}.${(v % 100000000n).toString().padStart(8, "0")}`;

/**
 * Draws the fixed-capacity tree with this customer's pair positions and their
 * authentication path highlighted. Legible up to 32 pairs; beyond that the
 * per-part ladder carries the same information without the crush.
 */
export function treeSvg(bundle: Bundle, highlight: PartPath[]): SVGSVGElement {
  const capacity = bundle.capacity,
    depth = Math.log2(capacity);
  const width = 720,
    rowHeight = 54,
    height = (depth + 1) * rowHeight + 30;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "tree-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Merkle tree of ${capacity} pairs with your positions highlighted`);

  const mine = new Set(highlight.map((p) => p.part.pairPosition));
  // A node is on a path when it is an ancestor of one of the customer's positions.
  const onPath = new Set<string>();
  const siblingOf = new Set<string>();
  for (const position of mine) {
    let index = position;
    for (let level = 0; level <= depth; level++) {
      onPath.add(`${level}:${index}`);
      if (level < depth) siblingOf.add(`${level}:${index ^ 1}`);
      index >>= 1;
    }
  }

  const element = (name: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const x = (level: number, index: number) => {
    const count = capacity >> level;
    return ((index + 0.5) * width) / count;
  };
  const y = (level: number) => height - 22 - level * rowHeight;

  for (let level = 0; level < depth; level++) {
    for (let index = 0; index < capacity >> level; index++) {
      const line = element("line", {
        x1: x(level, index),
        y1: y(level),
        x2: x(level + 1, index >> 1),
        y2: y(level + 1),
        class: onPath.has(`${level}:${index}`) ? "edge on" : "edge",
      });
      svg.append(line);
    }
  }
  for (let level = 0; level <= depth; level++) {
    for (let index = 0; index < capacity >> level; index++) {
      const key = `${level}:${index}`;
      const kind = level === 0 && mine.has(index) ? "mine" : onPath.has(key) ? "on" : siblingOf.has(key) ? "sibling" : "other";
      svg.append(element("circle", { cx: x(level, index), cy: y(level), r: kind === "mine" ? 7 : 5, class: `node ${kind}` }));
    }
  }
  const rootLabel = element("text", { x: width / 2, y: y(depth) - 14, class: "tree-label", "text-anchor": "middle" });
  rootLabel.textContent = "root";
  svg.append(rootLabel);
  return svg;
}

export function pathLadder(path: PartPath, bundle: Bundle): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ladder";
  const head = document.createElement("p");
  head.className = "ladder-head";
  head.innerHTML = `<strong>Part ${path.part.partIndex + 1}</strong> · ${usd(path.part.amount)} · pair position ${path.part.pairPosition}`;
  wrap.append(head);

  const rows: [string, string][] = [
    ["Your leaf", `${short(path.leaf.hash)} · sum ${usd(path.leaf.sum)}`],
    ...path.steps.map(
      (s) =>
        [
          `Level ${s.level + 1} — sibling on the ${s.direction ? "left" : "right"}`,
          `${short(s.sibling.hash)} · sum ${usd(s.sibling.sum)} → ${short(s.result.hash)}`,
        ] as [string, string],
    ),
    ["Computed root", short(path.root.hash)],
    ["On-chain root", short(bundle.rootHash)],
  ];
  const table = document.createElement("table");
  table.className = "ladder-table";
  for (const [label, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    table.append(tr);
  }
  wrap.append(table);
  const verdict = document.createElement("p");
  const matches = path.root.hash === bundle.rootHash && path.root.sum === bundle.rootSum;
  verdict.className = matches ? "ladder-verdict ok" : "ladder-verdict fail";
  verdict.textContent = matches ? "✓ This part hashes to the published root." : "✗ This part does not reach the published root.";
  wrap.append(verdict);
  return wrap;
}
