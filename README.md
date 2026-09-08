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

## Merkle-sum solution branch

See [the Merkle-sum solution guide](docs/merkle-sum.md) for salted identities,
split customer balances, full customer verification and the `MerkleSumRegistry`
contract. This alternative computes root and liabilities on-chain from public
partial amounts; it does not use ZK proofs. Run `npm run test:merkle` and follow
the guide for the local demo and privacy limitations.
