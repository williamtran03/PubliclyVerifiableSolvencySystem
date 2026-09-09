# PubliclyVerifiableSolvencySystem

Blockchain Challenge 2026 — Case 5: Publicly Verifiable Solvency System.

## Dev environment

Tool versions are pinned locally via [mise](https://mise.jdx.dev) 

- Node 22
- Foundry 1.7.1

```shell
make demo   # build + test
```

## Layout

- `contracts/` — Solidity sources 
- `test/` — Foundry tests
- `script/` — Foundry scripts
- `lib/` — vendored deps
# Integrated Merkle-sum and split-balance solutions

See [the integration guide](docs/merkle-sum.md). The existing Poseidon2/Noir/Honk
and KZG workflows remain available. `npm run merkle -- build-zk` produces private
split-balance bundles and witness inputs compatible with the existing circuit.
`npm run merkle -- build` selects the separate public Keccak implementation.
Run `npm run test:prover`, `forge test` and `npx tsc --noEmit` for regression checks.

