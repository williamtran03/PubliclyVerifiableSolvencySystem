import { test, expect, type Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, parseAbi, zeroAddress } from "viem";
import { buildSplitLiabilities } from "../../arms/published-ledger/prover/splitLiabilities.ts";

const registry = "0x1111111111111111111111111111111111111111";
const rpc = "https://rpc.test/";
const snapshotId = `0x${"ab".repeat(32)}` as const;
const prepared = buildSplitLiabilities([{ customerId: "alice", name: "Alice", dateOfBirth: "2000-01-01", parts: [{ assetId: 0, amount: 100n }] }], snapshotId, 1);
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
const upload = (value: unknown) => ({ name: "proof.json", mimeType: "application/json", buffer: Buffer.from(json(value)) });
const abi = parseAbi([
  "struct Epoch { bytes32 snapshotId; uint256[] rootHashes; uint256[] liabilities; uint256[] reserves; uint64 timestamp; }",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256) view returns (Epoch)",
  "function assets(uint256) view returns (address)",
  "function isCurrent() view returns (bool)",
  "function epochAge() view returns (uint64)",
  "function maxEpochAge() view returns (uint64)",
  "function lapses() view returns (uint64)",
]);

async function setup(page: Page) {
  let block = 1;
  let current = true;
  let fail = false;
  let pause: (() => Promise<void>) | undefined;
  let completedReads = 0;
  await page.route(rpc, async route => {
    const request = route.request().postDataJSON();
    if (fail) {
      await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Test RPC unavailable" } } });
      return;
    }
    let result: unknown;
    if (request.method === "eth_blockNumber") {
      const capturedBlock = block;
      const wait = pause;
      pause = undefined;
      if (wait) await wait();
      result = `0x${capturedBlock.toString(16)}`;
    } else if (request.method === "eth_getLogs") {
      expect(request.params[0].fromBlock).toBe("0x0");
      expect(request.params[0].toBlock).toMatch(/^0x[12]$/);
      completedReads++;
      result = []; // Unavailable history must not prevent private verification.
    } else if (request.method === "eth_call") {
      const { functionName } = decodeFunctionData({ abi, data: request.params[0].data });
      const values = {
        epochCount: BigInt(request.params[1]),
        getEpoch: { snapshotId, rootHashes: prepared.ledger.assets.map(a => a.rootHash), liabilities: [100n], reserves: [200n], timestamp: 1_800_000_000n },
        assets: zeroAddress, isCurrent: current, epochAge: 10n, maxEpochAge: 86400n, lapses: 0n,
      };
      result = encodeFunctionResult({ abi, functionName, result: values[functionName] });
    } else throw new Error(`Unexpected RPC method ${request.method}`);
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
  await page.goto("/");
  await page.locator('[data-id="published-ledger"]').click();
  await page.locator("#rpc").fill(rpc);
  await page.locator("#registry").fill(registry);
  await page.locator("#load").click();
  await expect(page.locator("#loadStatus")).toHaveText("Snapshot loaded from the registry.");
  await page.locator("#unitMode").selectOption("proof");
  await page.locator("#account").fill("alice");
  await page.locator(".balance").fill("100");
  await page.locator("#proof").setInputFiles(upload(prepared.bundles[0]));
  return {
    setBlock(value: number) { block = value; },
    expire() { current = false; },
    fail(value: boolean) { fail = value; },
    get reads() { return completedReads; },
    pauseNext() {
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      pause = () => { entered(); return gate; };
      return { waiting, release };
    },
  };
}

for (const input of ["balance", "account", "proof", "secret", "unitMode"]) {
  test(`editing ${input} clears a previous verification result`, async ({ page }) => {
    await setup(page);
    await page.locator("#verify").click();
    await expect(page.locator("#verifyStatus")).toHaveClass("good");
    if (input === "balance") await page.locator(".balance").fill("101");
    if (input === "account") await page.locator("#account").fill("bob");
    if (input === "proof") await page.locator("#proof").setInputFiles([]);
    if (input === "secret") await page.locator("#secret").evaluate((element: HTMLInputElement) => { element.value = "1"; element.dispatchEvent(new Event("input", { bubbles: true })); });
    if (input === "unitMode") await page.locator("#unitMode").selectOption("human");
    await expect(page.locator("#verifyStatus")).not.toHaveClass("good");
    await expect(page.locator("#verifyStatus")).not.toContainText("included");
  });
}

test("an edited balance discards a pending verification response", async ({ page }) => {
  const state = await setup(page);
  const pending = state.pauseNext();
  await page.locator("#verify").click();
  await pending.waiting;
  await page.locator(".balance").fill("101");
  pending.release();
  await expect.poll(() => state.reads).toBe(2);
  await expect(page.locator("#verifyStatus")).toBeEmpty();
});

test("a newer verification attempt wins over an older response", async ({ page }) => {
  const state = await setup(page);
  const pending = state.pauseNext();
  await page.locator("#verify").click();
  await pending.waiting;
  await page.locator(".balance").fill("101");
  await page.locator("#verify").click();
  await expect(page.locator("#verifyStatus")).toHaveClass("error");
  pending.release();
  await expect.poll(() => state.reads).toBe(3);
  await expect(page.locator("#verifyStatus")).toHaveClass("error");
});

test("reload clears verification and ignores an older load response", async ({ page }) => {
  const state = await setup(page);
  await page.locator("#verify").click();
  await expect(page.locator("#verifyStatus")).toHaveClass("good");
  const pending = state.pauseNext();
  await page.locator("#load").click();
  await pending.waiting;
  await expect(page.locator("#verifyStatus")).toBeEmpty();
  await expect(page.locator("#publicLedger")).toBeHidden();
  state.setBlock(2);
  await page.locator("#load").click();
  await expect(page.locator(".snapshot-meta strong").first()).toHaveText("1");
  pending.release();
  await expect.poll(() => state.reads).toBe(4);
  await expect(page.locator(".snapshot-meta strong").first()).toHaveText("1");
});

test("public ledger fallback rejects tampering and displays authenticated entries", async ({ page }) => {
  await setup(page);
  const tampered = JSON.parse(json(prepared.ledger));
  tampered.assets[0].entries[0].balance = "101";
  await page.locator("#publicLedgerFile").setInputFiles(upload(tampered));
  await expect(page.locator("#publicLedgerStatus")).toHaveClass("error");
  await page.locator("#publicLedgerFile").setInputFiles(upload(prepared.ledger));
  await expect(page.locator("#publicLedger svg")).toBeVisible();
});


test("automatic refresh preserves inputs and clears results when the epoch changes", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.locator("#verify").click();
  await expect(page.locator("#verifyStatus")).toHaveClass("good");
  await page.clock.runFor(30_000);
  await expect.poll(() => state.reads).toBe(3);
  await expect(page.locator(".balance")).toHaveValue("100");
  await expect(page.locator("#verifyStatus")).toHaveClass("good");
  state.setBlock(2);
  await page.clock.runFor(30_000);
  await expect(page.locator(".snapshot-meta strong").first()).toHaveText("1");
  await expect(page.locator("#verifyStatus")).toContainText("Select the matching customer bundle");
  await expect(page.locator("#proof")).toHaveValue("");
  await expect(page.locator(".balance")).toHaveValue("100");
  await expect(page.locator("#refreshStatus")).toContainText("Last updated:");
});

test("automatic refresh marks expired snapshots and recovers from RPC failures", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.locator("#verify").click();
  await expect(page.locator("#verifyStatus")).toHaveClass("good");
  state.expire();
  await page.clock.runFor(30_000);
  await expect(page.locator("#verifyStatus")).toContainText("expired");
  await expect(page.locator("#freshness")).toHaveClass("warning");
  state.fail(true);
  await page.clock.runFor(30_000);
  await expect(page.locator("#refreshStatus")).toContainText("Refresh failed");
  await expect(page.locator("#snapshot")).toBeVisible();
  state.fail(false);
  await page.clock.runFor(30_000);
  await expect(page.locator("#refreshStatus")).not.toContainText("Refresh failed");
});

test("a refresh cannot overwrite a changed connection", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  const pending = state.pauseNext();
  await page.clock.runFor(30_000);
  await pending.waiting;
  await page.locator("#registry").fill("0x2222222222222222222222222222222222222222");
  pending.release();
  await expect.poll(() => state.reads).toBe(2);
  await expect(page.locator("#snapshot")).toBeHidden();
  await expect(page.locator("#refreshStatus")).toBeEmpty();
});

test("hidden tabs pause refresh and becoming visible refreshes immediately", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.clock.runFor(60_000);
  expect(state.reads).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.reads).toBe(2);
});
