import { anchor, retrieveProof, localResult, parseUsdInput } from "./minimumClient.ts";
import { stringify, type Bundle } from "../../prover/minimum/tree.ts";
import { paths, treeSvg, pathLadder } from "./treeView.ts";
import { connectionPanel, markNavigation, output, element, button, value } from "./shared.ts";

/**
 * Demo front door only. The real boundary is the backend's expiring bearer token:
 * this gate releases no data, it just reveals the page during a walkthrough.
 */
const DEMO_PASSWORD = "test";
const SESSION = "solvency.minimum.demo-signed-in";

markNavigation();
const connection = connectionPanel();
let bundle: Bundle | undefined;

function showAccount() {
  element("loginView").hidden = true;
  element("accountView").hidden = false;
}
function showLogin() {
  element("accountView").hidden = true;
  element("loginView").hidden = false;
  element("inclusion").hidden = true;
  bundle = undefined;
}

try {
  if (sessionStorage.getItem(SESSION) === "1") showAccount();
} catch {
  /* private browsing */
}

button("signIn").onclick = () => {
  const supplied = value("password");
  (element<HTMLInputElement>("password")).value = "";
  if (supplied !== DEMO_PASSWORD) {
    output("loginResult", "INVALID: wrong password.");
    return;
  }
  output("loginResult", "");
  try {
    sessionStorage.setItem(SESSION, "1");
  } catch {
    /* private browsing */
  }
  showAccount();
};
element("password").addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key === "Enter") button("signIn").click();
});

button("signOut").onclick = () => {
  try {
    sessionStorage.removeItem(SESSION);
  } catch {
    /* private browsing */
  }
  for (const id of ["accessToken", "customerId", "fullBalance"]) element<HTMLInputElement>(id).value = "";
  output("verifyResult", "");
  showLogin();
};

function renderInclusion(current: Bundle) {
  const walks = paths(current);
  const figure = element("treeFigure");
  figure.replaceChildren();
  if (current.capacity <= 32) figure.append(treeSvg(current, walks));
  else {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = `Capacity ${current.capacity} is too wide to draw legibly; the per-part hashing steps below carry the same proof.`;
    figure.append(note);
  }
  const ladders = element("ladders");
  ladders.replaceChildren(...walks.map((walk) => pathLadder(walk, current)));
  element("inclusion").hidden = false;
}

button("verifyBtn").onclick = async () => {
  const client = connection();
  const token = value("accessToken");
  element<HTMLInputElement>("accessToken").value = "";
  const customer = value("customerId"),
    dob = value("dateOfBirth"),
    expected = value("fullBalance");
  button("verifyBtn").disabled = true;
  element("inclusion").hidden = true;
  output("verifyResult", "Retrieving your bundle…");
  try {
    const expectedUnits = parseUsdInput(expected);
    const retrieved = await retrieveProof(token);
    const current = await client.current();
    output("connection", "Read at block " + current.blockNumber);
    const result = localResult(retrieved, customer, dob, expectedUnits, anchor(current));
    output("verifyResult", result);
    // An outdated epoch is reported, not drawn: its path leads to a root nobody published.
    if (result.startsWith("VALID")) {
      bundle = retrieved;
      renderInclusion(retrieved);
    }
  } catch (e) {
    output("verifyResult", `INVALID: ${e instanceof Error ? e.message : e}`);
  } finally {
    button("verifyBtn").disabled = false;
  }
};

button("downloadBundle").onclick = () => {
  if (!bundle) return;
  const blob = new Blob([stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${bundle.customerId}-proof-bundle.json`;
  link.click();
  URL.revokeObjectURL(url);
};
