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

| branch | how the tree is proven honest | verifier |
|---|---|---|
| `main` | not proven — the prover is trusted not to insert a negative balance | — |
| `feat/zk-solvency` | Noir circuit over the whole tree, UltraHonk | ~500k gas on-chain |
| `feat/snarkless-solvency` | KZG grand sum + committed bit-decomposition, no SNARK | ~120k gas on-chain |

Both branches close the same hole from opposite directions; see
[docs/comparison.md](docs/comparison.md) on either branch.

## Run it

```shell
make test    # forge tests + prover unit tests
make demo    # anvil, deploy, attest reserves, publish, verify, then fail on purpose
```

`make demo` is the integration test. It stands up a local chain, deploys the
registry, has each reserve wallet sign for itself, builds the real tree from
`prover/customers.csv`, publishes the root, verifies a customer's inclusion
proof against the live chain, shows a superseded proof being rejected, then
drains a reserve and asserts the next submission is refused.

## Layout

```
contracts/   SolvencyRegistry.sol — the only public state
prover/      custodian side: tree, hashes, proof generation  (private inputs)
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
4. [docs/limitations.md](docs/limitations.md) — what "proof of solvency" does not mean
