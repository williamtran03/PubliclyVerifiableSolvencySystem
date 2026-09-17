# PubliclyVerifiableSolvencySystem

Blockchain Challenge 2026 — Case 5: Publicly Verifiable Solvency System.

This branch contains three runnable solvency arms plus a single-asset measurement
control. The three runnable arms are the product choices exposed by OpenSolvency;
the control remains only so the gas comparison has a stable baseline.

## The arms

Each directory under `arms/` is self-contained — `contracts/`, `prover/`,
`test/`, `script/`, `fixtures/` — so one arm can be read without the others.

| Arm | Core idea |
| --- | --- |
| `arms/published-ledger` | Publish every anonymised part on-chain, one merkle-sum tree per asset; the contract recomputes every total |
| `arms/zk-circuit` | Noir/UltraHonk proof that each asset's liabilities stay under a public reserve floor; liabilities stay private |
| `arms/snarkless` | KZG polynomial commitments: total, non-negativity and customer inclusion verified on-chain, no circuit |
| `arms/single-asset` | Measurement control only; not exposed by OpenSolvency |

Shared, deliberately: `shared/contracts/ReserveRegistry.sol` (company and auditor
roles, and reserve wallets that prove control by signature, used by every registry),
`shared/merkleSumTree.ts` (the Poseidon2 tree core and username encoding) and
`shared/customers.csv` (the common input the single-asset and snarkless arms use).

`docs/comparison.md` reads across all four implementations, including the measurement control.

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
- `shared/` — the reserve registry base, the tree core and the common customer set
- `open-solvency/` — shared customer and company website for the three current arms (`npm run web`)
- `scripts/demo/` — reproducible three-chain Anvil demo (`npm run demo`)
- `docs/` — the cross-arm comparison
- `lib/` — vendored deps
