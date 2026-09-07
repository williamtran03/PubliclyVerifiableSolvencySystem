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

**You are on `feat/zk-solvency`.** The root arrives with a Noir/UltraHonk proof
that every leaf is a valid `u128` and every leaf id is distinct — proven over the
whole tree, revealing none of it. Without that, an inclusion proof convinces one
customer about one leaf and says nothing about a negative balance hiding in
another. See [docs/zk.md](docs/zk.md).

| branch | how the tree is proven honest | on-chain cost |
|---|---|---|
| `main` | not proven — the prover is trusted not to insert a negative balance | 90k gas |
| `feat/zk-solvency` | Noir circuit over the whole tree, UltraHonk | ~3.9M gas |
| `feat/snarkless-solvency` | KZG grand sum, no circuit and no SNARK | see that branch |

Both branches close the same hole from opposite directions; see
[docs/comparison.md](docs/comparison.md).

## Run it

```shell
make test    # forge tests + prover unit tests + circuit tests
make prove   # rebuild the tree, the proof, and the Solidity verifier (needs nargo + bb)
make demo    # anvil, deploy, attest reserves, publish with proof, then fail on purpose
```

`make test` and `make demo` run against the committed proof and verifier, so
neither needs the circuit toolchain installed. `make prove` does.

`make demo` is the integration test. It stands up a local chain, deploys the
registry, has each reserve wallet sign for itself, builds the real tree from
`prover/customers.csv`, publishes the root together with its validity
proof, verifies a customer's inclusion proof against the live chain, then shows
three refusals: the same proof reused for a smaller total, a root with no proof
at all, and a submission after a reserve is drained.

## Layout

```
circuits/    the Noir circuit and its tests
contracts/   SolvencyRegistry.sol, the ZK-gated registry, the generated verifier
prover/      custodian side: tree, hashes, proof generation  (private inputs)
cli/         customer side: check your own balance against the chain
script/      deploy + the end-to-end demo
test/        Foundry tests, run against the real prover fixture
docs/        what leaks, what can be faked, what this does not claim
```

## Toolchain

Node 22, Foundry 1.7.1, Solidity 0.8.28, Noir 1.0.0-beta.26, Barretenberg
6.0.0-nightly.20260902. Versions are pinned in `.mise.toml` (`mise install`) and
in `docs/zk.md` for the circuit half; the same versions run in CI.

## Reading order

1. [docs/architecture.md](docs/architecture.md) — how the pieces fit and why
2. [docs/privacy.md](docs/privacy.md) — what a proof reveals, per snapshot and across them
3. [docs/manipulations.md](docs/manipulations.md) — attacks that work and attacks that do not
4. [docs/zk.md](docs/zk.md) — what the circuit proves, what it costs, and why Noir
5. [docs/limitations.md](docs/limitations.md) — what "proof of solvency" does not mean
