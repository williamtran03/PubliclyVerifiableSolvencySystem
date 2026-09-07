/**
 * Generates the KZG structured reference string this project develops against.
 *
 *   npx tsx script/setup.ts [maxDegree]
 *
 * READ THIS BEFORE USING IT FOR ANYTHING REAL. The SRS is generated here from a
 * tau that this process invents and then drops. Anyone who knows tau can open
 * any commitment to any value, so a locally generated SRS provides no binding
 * at all against the party that generated it — which is the custodian. It is
 * fine for development and for a demo; it is not a trusted setup.
 *
 * A deployment takes these points from a ceremony instead (perpetual powers of
 * tau, or Aztec Ignition), where soundness rests on at least one participant
 * having discarded their share. `loadSrs` reads the same JSON shape, so
 * swapping in ceremony output is a file change, not a code change.
 */
import { generateSrs, saveSrs } from "../prover/kzg/srs.ts";

const maxDegree = Number(process.argv[2] ?? 16);
const path = "fixtures/srs.json";

saveSrs(generateSrs(maxDegree), path);
console.log(`wrote ${path} with powers of tau up to degree ${maxDegree}`);
console.log("this is a development SRS with no ceremony behind it — see the note in script/setup.ts");
