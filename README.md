# Publicly Verifiable Solvency System

Blockchain Challenge 2026 — Case 5.

A custodian publishes one number per epoch: what it owes everybody. The number
is computed by a Merkle-sum tree rather than typed in, every customer can check
their own balance is inside it without a wallet or an account, and the contract
refuses to record the number at all unless the custodian's attested reserves
cover it.

```
customers.csv  ──buildTree──▶  root {hash, sum}  ──one tx──▶  SolvencyRegistry
     private                        public                    reverts if insolvent
                                                                     │
proof-<user>.json  ──verify-inclusion──────────────────────────────┘
     private to that customer          read-only, no wallet, no gas
```

## Branches

**You are on `feat/snarkless-solvency`.** Liabilities are committed to as a
polynomial rather than a tree, and the total is proven by a single KZG opening
at zero — the grand-sum construction from Summa V2. One pairing check, no
circuit, no proving system, 392k gas. See [docs/kzg.md](docs/kzg.md).

| branch | how the tree is proven honest | `submitEpoch` |
|---|---|---|
| `main` | not proven — the prover is trusted not to insert a negative balance | 90k gas |
| `feat/zk-solvency` | Noir circuit over the whole tree, UltraHonk | 3,858,239 gas |
| `feat/snarkless-solvency` | KZG grand sum, verified by the pairing precompile | 391,992 gas |

Both branches close the same hole from opposite directions; see
[docs/comparison.md](docs/comparison.md).

## Run it

```shell
make setup   # once: generate the development SRS
make commit  # commitments, grand sum opening, range argument, customer proofs
make test    # forge tests + prover unit tests
make demo    # anvil, deploy, attest reserves, publish, verify, then fail on purpose
```

Nothing here needs a circuit toolchain — Node and Foundry are the whole
dependency list.

`make demo` is the integration test. It stands up a local chain, deploys the
registry, has each reserve wallet sign for itself, builds the real tree from
`prover/customers.csv`, publishes the total together with its grand-sum
opening, has a customer verify inclusion through an on-chain view call, checks
the range argument against the hash the chain pinned, then shows an understated
total, an inflated balance, and a drained reserve all being refused.

## Layout

```
contracts/   SolvencyRegistry.sol, the KZG registry, the BN254 verifier library
prover/      custodian side: tree, hashes, proof generation  (private inputs)
prover/kzg/  the polynomial machinery: field, FFT, KZG, grand sum, range
cli/         customer side: check your own balance against the chain
script/      deploy + the end-to-end demo
test/        Foundry tests, run against the real prover fixture
docs/        what leaks, what can be faked, what this does not claim
```

## Toolchain

Node 22, Foundry 1.7.1, Solidity 0.8.28. Versions are pinned in `.mise.toml`
(`mise install`), and the same versions run in CI.

## Reading order

1. [docs/architecture.md](docs/architecture.md) — how the pieces fit and why
2. [docs/privacy.md](docs/privacy.md) — what a proof reveals, per snapshot and across them
3. [docs/manipulations.md](docs/manipulations.md) — attacks that work and attacks that do not
4. [docs/kzg.md](docs/kzg.md) — the grand sum, the range argument, and the setup caveat
5. [docs/comparison.md](docs/comparison.md) — this branch against the SNARK one, measured
6. [docs/limitations.md](docs/limitations.md) — what "proof of solvency" does not mean
