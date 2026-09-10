import { mkdirSync } from "node:fs";
import { generateSrs, saveSrs } from "../prover/kzg/srs.ts";
import { LEAF_CAPACITY } from "../prover/merkleSumTree.ts";

const MAX_DEGREE = 4 * LEAF_CAPACITY;

mkdirSync("./fixtures/kzg", { recursive: true });
saveSrs(generateSrs(MAX_DEGREE), "./fixtures/kzg/srs.json");
console.log(`Wrote fixtures/kzg/srs.json (max degree ${MAX_DEGREE})`);
