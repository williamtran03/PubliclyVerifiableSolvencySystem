# Public demo release runbook

This release is a coursework demonstration with fictional customers and test
tokens. It does not establish real financial backing or independent auditor
custody. One operator holds five distinct test keys locally; a named recovery
operator has encrypted backup access. Only one process may write to the deployment.

## 1. Assign owners and confirm the schedule

Name an operator, a recovery operator with access to the key backup, a reviewer for the
deployment, an RPC provider, and where private bundles are kept and for how long.

The settings are `MAX_EPOCH_AGE=2592000` (30 days) and `MIN_EPOCH_INTERVAL=60`.
Set these **before deployment**.
Publish a fresh epoch before the 30-day validity expires if grading is still ongoing.
These parameters cannot be changed on an existing registry. An expired snapshot
is labelled stale; `lapses` increments when a later epoch records the missed window,
not automatically each week.

## 2. Prepare and validate locally

Install Node 22, Foundry 1.7.1, nargo 1.0.0-beta.26 and bb
6.0.0-nightly.20260902. On Linux x86_64, install the pinned proving tools with:

```sh
python3 scripts/install-proving-tools.py
export PATH="$HOME/.local/share/opensolvency/proving-tools/bin:$PATH"
nargo --version
bb --version
```

The installer checks Noir's release SHA-256 and the official Barretenberg npm
package's SHA-512 integrity before installing the expected executable. It runs each
binary's version check before replacing it. Installation is local to the user;
system tools and shell startup files are unchanged. Other operating systems need
the corresponding official release binaries. Sources: [Noir release](https://github.com/noir-lang/noir/releases/tag/v1.0.0-beta.26)
and [Barretenberg package](https://www.npmjs.com/package/@aztec-foundation/bb-linux-x64/v/6.0.0-nightly.20260902).

Use the committed dependency lockfile:

```sh
npm ci
npx playwright install chromium
npm run validate
npm run test:pages
npm run test:integration
```

`test:pages` checks the existing production build under the project subpath.
`test:integration` generates fresh ZK proofs and requires both pinned proving tools.
The normal CI checks use fixture proofs and do not replace this check. Wallet keys
are not needed for CI validation or website publication.

Create five fresh test-only wallets. Configure `.env` locally using `.env.example`;
never commit keys or put them in Actions secrets for this workflow. Back them up
privately and check recovery. Keep `PRIVATE_OUTPUT` outside the repository.

Fund company initially with about 0.1–0.2 Sepolia ETH and auditor with about 0.01,
then check current fees. Fork measurements (28.4M deployment gas and 6.9M per
three-arm epoch) are estimates, not a spending guarantee. Company pays for normal
reserve re-proofs; the drill funds transactions sent by reserve wallets.

Check the operator RPC's chain ID, transaction submission and historical reads.
Check the public website RPC's HTTPS, CORS and limits. A domain-restricted frontend
API key is still public. Do not operate the CLI and MetaMask concurrently with the
same role wallet.

## 3. Deploy and exercise on public Sepolia

Follow [the Sepolia runbook](../scripts/sepolia/README.md):

```sh
npm run sepolia -- deploy
npm run sepolia -- epoch
npm run sepolia -- exercise
npm run sepolia -- epoch
npm run sepolia -- status
```

Wait for the minimum epoch interval when instructed. After an interruption, follow
the journal recovery instructions; retain the same keys. Do not manually clear
`pending` or edit drill checkpoints. Investigate consumed nonces with missing receipts.

Check all three registries, valid and wrong-balance verification, restored company
and auditor roles, restored reserves, and fresh post-drill epochs. Have the reviewer
check chain ID, addresses and transaction receipts. Commit `deployments/sepolia.json`
only after all operations finish and it contains no `pending` property. The website
build refuses records with that property because they can contain broadcastable
signed transactions. This build guard does not replace review before committing.

## 4. Export the public fictional examples

After publishing fresh epochs, run locally:

```sh
npm run demo:export -- --publish-synthetic-example
```

This read-only command uses the configured deployment record, `PRIVATE_OUTPUT` and
RPC. It checks Sepolia's chain ID and exports only `alice` (published ledger) and
`customer-123` (ZK and KZG), using the documented fixture amounts and account secret.
It strips unrelated metadata, checks successful and intentionally failing inclusion,
and writes one complete `open-solvency/public-examples/sepolia.json` only after all
three methods pass. It does not copy a directory or export other customers. The
ledger example deliberately discloses Alice Example's fictional name and birth date.

Review and commit that file. Never publish arbitrary bundles, raw input datasets,
`.env`, witnesses or the private output directory. This explicit synthetic export
is the sole exception to private customer-bundle delivery.

The site offers the download and proof-unit input values only when method,
registry, epoch and commitment match the loaded snapshot. Customers still run the
normal verification themselves. When an epoch changes, old examples disappear.
Re-export, review, commit and rebuild to publish examples for the new epochs.
No public example is generated by CI or fabricated before a Sepolia run.

## 5. Enable Pages and publish

The repository is public, with
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
Keep the `github-pages` environment configured to allow `main`.
No custom domain or DNS configuration is required. The expected project URL is:

`https://williamtran03.github.io/PubliclyVerifiableSolvencySystem/`

The workflow validates each push/PR. Only a push to
`main` or a manual run on `main` uploads the tested `open-solvency/dist/` artifact
and deploys it after validation succeeds. Feature branches and PRs never publish.
Pages deployment has its own narrowly scoped permissions; there are no signing keys.

The workflow follows GitHub's [custom Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
If site configuration or deployment fails, inspect Actions and rerun on `main`.
For a website rollback, revert the offending source commit and publish the validated
replacement. A website rollback does not undo blockchain transactions.

## 6. Acceptance at the final URL

- Record the release commit, website URL, registry addresses and public transaction hashes.
- From another browser/device, load all three presets and confirm Sepolia data.
- Download each public example, select proof units, enter its displayed values and verify.
- Change a claimed amount by one unit and confirm rejection.
- Publish a subsequent epoch and observe the open page detect it within the refresh cycle.
- Confirm stale snapshots and RPC errors are visible and old verification results are cleared.
- Exercise the company wallet UI if it is part of the assessment, and confirm the resulting receipt.
- Record evidence of the completed drill and fresh post-drill epochs.

## Operating constraints

The browser polls the selected loaded registry every 30 seconds while visible and
checks again when the tab becomes visible. RPC latency/retries can extend the delay.
It preserves entered amounts when asset definitions stay the same, clears an old
proof selection on epoch changes and retains the last snapshot with a warning on
RPC failure. Loading a snapshot starts polling; merely opening the page does not.

Displayed reserves are the recorded epoch values, not a continuously recomputed
solvency statement about every wallet transfer. A new on-chain epoch requires local
input preparation, proof generation, reserve control, auditor sampling and company
submission. The website neither generates proofs nor publishes epochs automatically.
It is not an unattended monitoring/notification service. The operator must check
freshness and distribute new private bundles when publishing an epoch.

GitHub Pages hosts static files; browser RPC reads and MetaMask submissions work
without a backend. It does not provide private downloads or server-side secret
storage. KZG inclusion checks disclose their parameters to the selected RPC.
Single-operator custody demonstrates on-chain permissions, not an independent
auditor. All implementations concern submitted records at a point in time and
cannot detect omitted liabilities. An independent security review and production
operations remain outside this coursework release.
