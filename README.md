# Publicly Verifiable Solvency System

Three working ways for a custodian to prove on-chain that its reserves cover what it
owes customers, built on one shared reserve registry and one shared customer set so
that they can be compared against each other. Blockchain Challenge 2026, Case 5.

Solvency claims today rest on an auditor's word. Here the claim is a transaction: an
epoch is recorded only if the contract itself has checked that reserves cover
liabilities, so anyone can confirm it from chain state, and every customer can confirm
that their own balance is inside the liabilities that were checked. The three arms
differ in what that costs and in what stays private.

## Quick start

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
(`nargo`) and Barretenberg (`bb`) are needed only to regenerate the ZK proof and are not
yet pinned; the committed fixtures run without them.

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

`shared/merkleSumTree.ts` is the Poseidon2 tree core, and `shared/customers.csv` is the
input every arm is measured on.

## Results

Full figures and the reasoning are in [`docs/comparison.md`](docs/comparison.md);
`make compare` regenerates every number in it. At domain size N = 8:

| Arm | Submission gas | Scaling |
|---|---:|---|
| Published ledger | 408,350 | grows with the number of parts |
| ZK circuit | 4,366,256 | constant on-chain; proving is the limit |
| Snarkless (KZG) | 1,556,777 | constant on-chain |

Execution gas under the Osaka rules Ethereum runs today, without the 21,000 base cost
and calldata. Real transactions on a Sepolia fork cost 4,536,873 (ZK) and 1,679,265
(KZG); the comparison explains the difference.

The ZK circuit as committed compiles up to 8,192 leaves; a flat-array rewrite reaches
16,384 at 6.5 GiB peak memory and fails inside Barretenberg at 32,768
([`arms/zk-circuit/bench/`](arms/zk-circuit/bench/README.md)). A leaf is one
(customer, asset) pair, so a customer holding three assets takes three. A real custodian
needs batching or recursion across many proofs.

## Layout

- `arms/` — one directory per implementation
- `shared/` — the reserve registry base, the directory, the tree core, the customer set
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
| [`docs/deployment.md`](docs/deployment.md) | What must be true before hosting the website or deploying contracts |

## Status

All three arms run end to end, on local chains, with tests covering the contracts, the
provers, the three-chain demo and the website in a real browser. GitHub Actions runs
`npm run validate` on every push and pull request. The Sepolia tooling in
[`scripts/sepolia/`](scripts/sepolia/README.md) has been rehearsed on a Sepolia fork,
not yet run on Sepolia itself. Not done: a public testnet
deployment, an independent audit, and a non-cryptographic baseline (a bond plus an
attested customer count) that would test whether ZK is needed at all. Read
[`docs/deployment.md`](docs/deployment.md) before hosting the website or deploying
contracts.

Coursework, not a production system. Contract sources carry MIT SPDX headers.
