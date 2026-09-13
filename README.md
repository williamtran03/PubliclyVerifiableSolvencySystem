# PubliclyVerifiableSolvencySystem

Blockchain Challenge 2026 — Case 5: Publicly Verifiable Solvency System.

This branch is the **comparison study**: four implementations of the same claim,
built so they can be measured against each other in one build. The standalone
product built for the presentation demo lives on the `minimum` branch.

## The arms

Each directory under `arms/` is self-contained — `contracts/`, `prover/`,
`test/`, `script/`, `fixtures/` — so one arm can be read without the others.

| Arm | Core idea |
| --- | --- |
| `arms/published-ledger` | Publish the whole anonymised ledger on-chain; anyone recomputes the root |
| `arms/zk-circuit` | Noir/UltraHonk proof that the public total was honestly built from private balances, multi-asset |
| `arms/snarkless` | KZG polynomial commitments; the total is one pairing check, no circuit |
| `arms/single-asset` | Superseded by `zk-circuit`; kept because the comparison quotes its gas and bytecode |

Only two things are shared, deliberately: `shared/merkleSumTree.ts` (the tree
structure three arms build on) and `shared/customers.csv` (the common input
every arm is measured against).

`docs/comparison.md` is the deliverable that reads across all four.

## Dev environment

Tool versions are pinned locally via [mise](https://mise.jdx.dev).

- Node 22
- Foundry 1.7.1

```shell
make build     # forge build
make test      # forge test + every arm's Node tests + the Anvil end-to-end test
make check     # tsc --noEmit + forge fmt --check
make compare   # regenerate the gas figures in docs/comparison.md
```

Per-arm targets are prefixed by arm — `ledger-`, `zk-`, `kzg-`, `single-`.
Run `make -np | grep '^[a-z].*:' ` or read the header of the `Makefile` for the
full list.

## Layout

- `arms/` — one directory per implementation
- `shared/` — the tree core and the common customer set
- `demo-site/` — customer-facing site for the `zk-circuit` arm
- `docs/` — the cross-arm comparison
- `lib/` — vendored deps
