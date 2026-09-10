# Minimum audited solvency prototype

The `minimum` branch adds fixed-capacity split Merkle-sum USD liabilities,
separate company/reserve-owner/auditor roles, validated oracle rounds, historical
claims, a public RPC dashboard and authenticated customer proof retrieval with
local browser verification. Existing cryptographic prover paths are retained.

See [architecture, setup, deployment, commands and security limitations](docs/minimum-architecture.md).

Quick local start, in separate terminals:

```bash
forge build
anvil --host 127.0.0.1 --port 8545
```

```bash
npm run demo:minimum -- /tmp/minimum-demo
MINIMUM_PRIVATE_DIR=/tmp/minimum-demo npm run backend
```

```bash
npm run dev -- --host 127.0.0.1
```

Use a new private directory outside this repository. The demo prints the registry
address; credentials are written privately to `credentials.private.json` in that
directory. Never publish it. `npm test` runs unit tests and a disposable Anvil
integration; `forge test` runs contract unit/fuzz tests.

Inclusion does not establish completeness. Historical reserve balances and
eligibility require auditor attestation; assets are not locked. This is a prototype,
not a production system or regulatory audit.

---

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

