import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { saveSrs } from "../prover/srs.ts";
import { srsFromPtau } from "../prover/ceremony.ts";
import { LEAF_CAPACITY } from "../../../shared/merkleSumTree.ts";

const MAX_DEGREE = 4 * LEAF_CAPACITY;
const CEREMONY = {
  url: "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_08.ptau",
  sha256: "5c411c13838e8e3ff80b6f87b81a0a92a66d2e64e82dd6af88ffc8ea89a548f6",
};

const local = process.argv[2];
const file = new Uint8Array(local ? readFileSync(local) : await (await fetch(CEREMONY.url)).arrayBuffer());
const digest = createHash("sha256").update(file).digest("hex");
if (digest !== CEREMONY.sha256) {
  throw new Error(`ceremony file hash ${digest} does not match the pinned ${CEREMONY.sha256}`);
}

mkdirSync("./arms/snarkless/fixtures", { recursive: true });
saveSrs(srsFromPtau(file, MAX_DEGREE, LEAF_CAPACITY - 1), "./arms/snarkless/fixtures/srs.json", CEREMONY.url);
console.log(`Wrote arms/snarkless/fixtures/srs.json (max degree ${MAX_DEGREE}) from ${CEREMONY.url}`);
