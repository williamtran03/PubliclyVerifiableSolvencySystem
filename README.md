# Publicly Verifiable Solvency System

Three working ways for a custodian to prove on-chain that its reserves cover what it
owes customers, built on one shared reserve registry so that they can be compared
against each other. Blockchain Challenge 2026, Case 5.

Solvency claims today rest on an auditor's word. Here the claim is a transaction: an
epoch is recorded only if the contract itself has checked that reserves cover
liabilities, so anyone can confirm it from chain state, and every customer can confirm
that their own balance is inside the liabilities that were checked. The three arms
differ in what that costs and in what stays private.

## Try it online

The website is live at
**<https://williamtran03.github.io/PubliclyVerifiableSolvencySystem/>** and reads
three registries on the Sepolia testnet. No wallet or install is needed.

1. Pick a proof method and click **Use Sepolia deployment**. The site loads the latest
   snapshot: epoch, reserves and liabilities per asset.
2. Under **Verify my balances**, a fictional customer is shown. Download its proof file.
3. Set **Amount units** to *Proof units*, enter the customer ID, the balances and the
   secret shown, and select the downloaded file.
4. Click **Verify proof**. Change any balance by one unit and verify again: it fails.

Customers, tokens and reserves are fictional test data. Each snapshot is valid for 30
days; addresses and transactions are in
[`docs/sepolia-release-2026-09-25.md`](docs/sepolia-release-2026-09-25.md).

## Run it locally

```shell
make build
npm ci
npx playwright install chromium
npm run validate  # typecheck, format, Foundry and Node tests, build, Anvil demo, browser tests
make test         # validate plus the fresh ZK proof integration test (needs nargo and bb)
npm run demo      # three local chains, one per arm, plus the customer and company site
```

`npm run demo` starts three Anvil nodes, deploys a registry on each, runs a full epoch,
writes each customer's private proof bundle to a temporary directory, and serves the
website against all three. Ctrl+C stops only what it started. The walkthrough is in
[`scripts/demo/README.md`](scripts/demo/README.md).

Node 22 and Foundry 1.7.1, pinned in CI. Noir
(`nargo`) and Barretenberg (`bb`) are needed to generate fresh ZK proofs. The prover
requires nargo 1.0.0-beta.26 and bb 6.0.0-nightly.20260902; Linux x86_64 users can run
`python3 scripts/install-proving-tools.py` and add
`~/.local/share/opensolvency/proving-tools/bin` to `PATH`. The committed fixtures run
without these tools.

## The three arms

Each directory under `arms/` is self-contained (`contracts/`, `prover/`, `test/`,
`script/`, `fixtures/`), so one arm can be read without the others.

| Arm | Approach | Public | Private |
|---|---|---|---|
| [`arms/published-ledger`](arms/published-ledger/README.md) | The contract rebuilds a merkle-sum tree per asset from calldata | Every anonymised part and every total | Only who owns which part |
| [`arms/zk-circuit`](arms/zk-circuit/README.md) | A Noir/UltraHonk proof that each asset's liabilities stay under a public floor | A root, the epoch context, one floor per asset | Every balance and the total |
| [`arms/snarkless`](arms/snarkless/README.md) | KZG commitments: the total is an opening at 0, non-negativity a range argument, no circuit | The total and the commitments | Every individual balance |
| `arms/single-asset` | Measurement control, superseded by the ZK arm | | |

The control arm is kept off the shared registry on purpose: its figures do not move
when the shared base changes, which keeps the gas comparison like-for-like.

## What all three share

`shared/contracts/ReserveRegistry.sol` holds the parts that are not about proving
liabilities:

- **Roles.** A company submits epochs; an auditor approves reserve wallets and samples
  balances. Each role rotates only itself, in two steps.
- **Windows.** Every recorded epoch opens a new window. A wallet counts only if it
  proves control again in that window, with an EIP-712 signature (ERC-1271 for
  multisigs) over the challenge the window opened with.
- **Sampling.** Reserves count at the lower of the auditor's sample and the live
  balance, and a submission needs a sample from an earlier block, so funds borrowed
  inside the submitting transaction add nothing.
- **Exclusivity.** `shared/contracts/ReserveDirectory.sol` is deployed once per chain
  and lets a wallet back one registry at a time.

`shared/merkleSumTree.ts` is the Poseidon2 tree core of the ZK arms; the ledger arm hashes
with keccak. The demo customers differ per arm,
because the arms model different things. `shared/customers.csv` (three customers, one
asset) feeds the KZG arm. The ZK arm's `arms/zk-circuit/prover/customers.csv` reuses those
usernames and salts, with one BTC, WETH or USDC holding each. The ledger arm's
`arms/published-ledger/fixtures/customers.example.json` identifies customers by name and
date of birth and splits balances into parts.

## Results

Full figures and the reasoning are in [`docs/comparison.md`](docs/comparison.md);
`make compare` regenerates every number in it. At domain size N = 8:

| Arm | Submission gas | Scaling |
|---|---:|---|
| Published ledger | 408,350 | grows with the number of parts |
| ZK circuit | 4,366,256 | constant on-chain; proving is the limit |
| Snarkless (KZG) | 1,556,777 | constant on-chain |

Execution gas under the Osaka rules Ethereum runs today, without the 21,000 base cost
and calldata. The public Sepolia submissions cost 4,536,813 (ZK), 1,679,265 (KZG) and
410,209 (ledger) in their first epoch; the comparison explains the difference.

These rows differ in assets and customers. On the same three customers and one asset,
the ledger costs 304,806, KZG 1,556,777 and a single-asset SNARK 4,023,440. Each extra
asset costs the SNARK verifier about 2,100 gas and KZG 1.0–1.3M, so ZK becomes the
cheaper one somewhere between two and five assets, depending on how the KZG side is
built. Both are measured; see *Like for like* and *Cost against asset count* in the
comparison.

The ZK circuit as committed compiles up to 8,192 leaves; a flat-array rewrite reaches
16,384 at 6.5 GiB peak memory and fails inside Barretenberg at 32,768
([`arms/zk-circuit/bench/`](arms/zk-circuit/bench/README.md)). A leaf is one
(customer, asset) pair, so a customer holding three assets takes three. A real custodian
needs batching or recursion across many proofs.

## Layout

- `arms/` — one directory per implementation
- `shared/` — the reserve registry base, the directory, the tree core, the KZG customer set
- `open-solvency/` — the customer and company website for the three arms (`npm run web`)
- `scripts/demo/` — the reproducible three-chain demo (`npm run demo`)
- `scripts/sepolia/` — deploys the three arms to Sepolia and publishes epochs (`npm run sepolia`)
- `docs/` — comparison, limitations, manipulations, related work, deployment
- `lib/` — vendored dependencies

Per-arm make targets are prefixed by arm (`ledger-`, `zk-`, `kzg-`, `single-`); the
`Makefile` header lists them.

## Documentation

| Document | Read it for |
|---|---|
| [`docs/comparison.md`](docs/comparison.md) | What the three arms cost, leak and assume, and which one to pick |
| [`docs/limitations.md`](docs/limitations.md) | What the system does not prove, stated plainly |
| [`docs/manipulations.md`](docs/manipulations.md) | Fifteen ways a dishonest custodian could try to pass, and what stops each |
| [`docs/related-work.md`](docs/related-work.md) | The prior schemes this builds on and where it differs |
| [`scripts/sepolia/README.md`](scripts/sepolia/README.md) | Deploying to Sepolia and publishing a new epoch |
| [`docs/public-demo-release.md`](docs/public-demo-release.md) | Releasing the public demo: examples, GitHub Pages, acceptance checks |
| [`docs/deployment.md`](docs/deployment.md) | What must be true before hosting the website or deploying contracts |

## Status

All three arms run end to end, locally and on Sepolia (deployed 25 September 2026),
with tests covering the contracts, the provers, the three-chain demo and the website in
a real browser. GitHub Actions runs `npm run validate` on every push and pull request
and publishes the website from `main`. Not done: an independent audit, and a
non-cryptographic baseline (a bond plus an attested customer count) that would test
whether ZK is needed at all. The gas figures above come from local measurements; the Sepolia receipts are listed
separately in the comparison.

Coursework, not a production system. Contract sources carry MIT SPDX headers.

## Use of AI tools

OpenAI Codex and Anthropic Claude (Claude Code) were used as programming and writing
assistants: drafting and refactoring code, tests and documentation, and reviewing
changes. The team chose the design, reviewed every change before committing it, and
checked the results with the test suites and the measurements in
[`docs/comparison.md`](docs/comparison.md). The authors are responsible for all
content.
