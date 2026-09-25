import { keccak256, encodePacked, type Hex } from "viem";
import { usernameToBigInt } from "../../../shared/merkleSumTree.ts";
import { FIELD_ORDER, NUM_ASSETS, type Holding } from "../prover/multiAssetTree.ts";

export const NARGO_TOML = `[package]
name = "circuit_bench"
type = "bin"
authors = [""]

[dependencies]
poseidon = { tag = "v0.3.0", git = "https://github.com/noir-lang/poseidon" }
`;

export function depthOf(capacity: number): number {
  const depth = Math.log2(capacity);
  if (!Number.isInteger(depth) || depth < 1) throw new Error(`capacity ${capacity} is not a power of two >= 2`);
  return depth;
}

export function assetCount(assets: number): number {
  if (!Number.isInteger(assets) || assets < 1) throw new Error(`asset count ${assets} is not a positive integer`);
  return assets;
}

export function mainNr(capacity: number, assets: number = NUM_ASSETS): string {
  const depth = depthOf(capacity);
  const levels = Array.from(
    { length: depth },
    (_, i) => `    let level${i + 1} = combine_level(${i === 0 ? "leaves" : `level${i}`});`,
  ).join("\n");

  return `use poseidon::poseidon2::Poseidon2;

global NUM_ASSETS: u32 = ${assetCount(assets)};
global CAPACITY: u32 = ${capacity};

fn combine_level<let M: u32>(hashes: [Field; M]) -> [Field; M / 2] {
    let mut next: [Field; M / 2] = [0; M / 2];
    for i in 0..(M / 2) {
        next[i] = Poseidon2::hash([hashes[2 * i], hashes[2 * i + 1]], 2);
    }
    next
}

fn main(
    usernames: [Field; CAPACITY],
    salts: [Field; CAPACITY],
    asset_ids: [u32; CAPACITY],
    amounts: [u64; CAPACITY],
    reserve_floors: pub [u64; NUM_ASSETS],
    context: pub Field,
) -> pub Field {
    let mut leaves: [Field; CAPACITY] = [0; CAPACITY];
    let mut liabilities: [u64; NUM_ASSETS] = [0; NUM_ASSETS];

    for i in 0..CAPACITY {
        assert(asset_ids[i] < NUM_ASSETS);
        leaves[i] =
            Poseidon2::hash([usernames[i], salts[i], asset_ids[i] as Field, amounts[i] as Field], 4);
        liabilities[asset_ids[i]] += amounts[i];
    }

    for a in 0..NUM_ASSETS {
        assert(liabilities[a] <= reserve_floors[a]);
    }

${levels}

    Poseidon2::hash([level${depth}[0], context], 2)
}
`;
}

export function mainNrFlat(capacity: number, assets: number = NUM_ASSETS): string {
  const depth = depthOf(capacity);
  const levels: string[] = [];
  let offset = 0;
  let width = capacity;
  for (let level = 1; level <= depth; level++) {
    const next = offset + width;
    levels.push(
      `    for i in 0..${width / 2} {\n` +
        `        nodes[${next} + i] = Poseidon2::hash([nodes[${offset} + 2 * i], nodes[${offset} + 2 * i + 1]], 2);\n` +
        `    }`,
    );
    offset = next;
    width /= 2;
  }

  return `use poseidon::poseidon2::Poseidon2;

global NUM_ASSETS: u32 = ${assetCount(assets)};
global CAPACITY: u32 = ${capacity};
global NODES: u32 = ${2 * capacity - 1};

fn main(
    usernames: [Field; CAPACITY],
    salts: [Field; CAPACITY],
    asset_ids: [u32; CAPACITY],
    amounts: [u64; CAPACITY],
    reserve_floors: pub [u64; NUM_ASSETS],
    context: pub Field,
) -> pub Field {
    let mut nodes: [Field; NODES] = [0; NODES];
    let mut liabilities: [u64; NUM_ASSETS] = [0; NUM_ASSETS];

    for i in 0..CAPACITY {
        assert(asset_ids[i] < NUM_ASSETS);
        nodes[i] =
            Poseidon2::hash([usernames[i], salts[i], asset_ids[i] as Field, amounts[i] as Field], 4);
        liabilities[asset_ids[i]] += amounts[i];
    }

    for a in 0..NUM_ASSETS {
        assert(liabilities[a] <= reserve_floors[a]);
    }

${levels.join("\n")}

    Poseidon2::hash([nodes[NODES - 1], context], 2)
}
`;
}

const draw = (seed: Hex, label: string, i: number): bigint =>
  BigInt(keccak256(encodePacked(["bytes32", "string", "uint256"], [seed, label, BigInt(i)])));

export function benchHoldings(capacity: number, seed: Hex, assets: number = NUM_ASSETS): Holding[] {
  return Array.from({ length: capacity }, (_, i) => ({
    username: `bench-${i}`,
    salt: draw(seed, "salt", i) % FIELD_ORDER,
    assetId: i % assetCount(assets),
    amount: (draw(seed, "amount", i) % 1_000_000_000n) + 1n,
  }));
}

export function proverToml(holdings: Holding[], context: bigint, assets: number = NUM_ASSETS): string {
  const floors = new Array<bigint>(assetCount(assets)).fill(0n);
  for (const h of holdings) floors[h.assetId] += h.amount;
  const list = (values: (string | number | bigint)[]) => `[${values.map((v) => `"${v}"`).join(", ")}]`;
  return [
    `usernames = ${list(holdings.map((h) => usernameToBigInt(h.username)))}`,
    `salts = ${list(holdings.map((h) => h.salt))}`,
    `asset_ids = ${list(holdings.map((h) => h.assetId))}`,
    `amounts = ${list(holdings.map((h) => h.amount))}`,
    `reserve_floors = ${list(floors)}`,
    `context = "${context}"`,
    "",
  ].join("\n");
}
