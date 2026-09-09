import { mkdirSync } from "node:fs";
import { generateSrs, saveSrs } from "../prover/kzg/srs.ts";
import { LEAF_CAPACITY } from "../prover/merkleSumTree.ts";

const MAX_DEGREE = 4 * LEAF_CAPACITY;

mkdirSync("./fixtures", { recursive: true });
saveSrs(generateSrs(MAX_DEGREE), "./fixtures/srs.json");
console.log(`Wrote fixtures/srs.json (max degree ${MAX_DEGREE})`);
