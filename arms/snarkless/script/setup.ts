import { mkdirSync } from "node:fs";
import { generateSrs, saveSrs } from "../prover/srs.ts";
import { LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";

const MAX_DEGREE = 4 * LEAF_CAPACITY;

mkdirSync("./arms/snarkless/fixtures", { recursive: true });
saveSrs(generateSrs(MAX_DEGREE), "./arms/snarkless/fixtures/srs.json");
console.log(`Wrote arms/snarkless/fixtures/srs.json (max degree ${MAX_DEGREE})`);
