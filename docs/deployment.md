# Deployment status

The website can be hosted as a research prototype. The repository is not yet a
production deployment package for real customer solvency attestations.

## Host the website

Use Node 22 and install the locked dependencies with `npm ci`. Run
`npm run web:build`, then publish **only `open-solvency/dist/`** to an HTTPS static
host. Do not publish the repository, proof-generation workspace, customer bundles,
account secrets or the Vite development server. Vite's development configuration
allows source imports from the repository and is intended for local development.

Customers configure an RPC URL and registry address for each method in the UI. Every
complete record in `deployments/*.json` becomes a preset button at build time, for
example **Use Sepolia deployment**, which fills in all three registries with a public
CORS-enabled RPC.
For a hosted deployment, provide independently authenticated registry addresses,
chain IDs and an HTTPS RPC that allows browser CORS requests. The local demo
configuration is not included in the static build. Customers must receive their
private proof files through an authenticated private channel.

The published-ledger reader queries historical events from block zero through the
snapshot block. When the provider refuses that range, as public Sepolia RPCs do, it
finds the submission block by the epoch's timestamp and queries the 50 blocks from
there. A missing history or contract-wallet wrapper does not block snapshot loading or
private verification.
Customers can select the public `ledger.json` to view its tree. The browser checks
its snapshot ID, recomputed roots and totals against the on-chain snapshot.
Automatic decoding of arbitrary multisig transactions is not implemented.

## Before real customer use

- **Deploy and authenticate the contracts.** The demo deployers accept only local
  Anvil nodes and use public development keys. `npm run sepolia`
  ([`scripts/sepolia/README.md`](../scripts/sepolia/README.md)) deploys to Sepolia with
  keys from `.env`, checks the Chainlink feeds, sets per-feed freshness limits and
  records every address and receipt in `deployments/sepolia.json`. Its assets are
  test tokens with unrestricted minting. A real deployment needs real asset
  addresses and decimal scales, and a company key and an auditor key held by
  different parties. Role transfer and reserve removal are not yet exercised on the
  testnet.
- **Make ZK proving reproducible.** Pin compatible Noir and Barretenberg versions,
  regenerate and check the verifier from the committed circuit, and run the real
  proof integration suite. Current fixture proofs are bound to their original
  registry, chain and epoch; a new deployment needs new proofs. The repository
  does not currently pin those two tool versions.
- **Review the cryptographic setup.** `arms/snarkless/prover/srs.ts` creates a
  single-process BN254 KZG setup. Establish reviewed setup provenance and a
  verifiable ceremony/import process before relying on it with real customers.
  Ethereum's blob KZG setup is for a different curve and cannot simply replace
  this project's setup. Do not regenerate the SRS for an existing deployment.
- **Review security and capacity.** Obtain an independent review of the contracts,
  circuits, KZG protocol, deployment configuration and customer-proof flow. The
  current KZG arm has eight slots and one asset; the ZK arm has eight holding slots
  across three assets; the published ledger caps each asset at 256 entries and
  supports at most eight assets. Split parts consume entries/holding slots.
- **Operate the service.** Define secure customer proof distribution, key custody,
  epoch refresh monitoring, incident handling and finality expectations. The UI
  reads the latest RPC block and reports wallet submission, not final confirmation.
  Users must be able to authenticate the website, RPC and registry configuration.

These are point-in-time claims over submitted records. Even correct proofs do not
detect omitted liabilities or prove that reserves remain available afterwards.

For background on why setup provenance matters, see the Ethereum Foundation's
[KZG ceremony explanation](https://blog.ethereum.org/2023/01/16/announcing-kzg-ceremony).
Its ceremony output is not a compatible setup for this BN254 implementation.

## Validation

Install browser support once with `npx playwright install chromium` (Linux CI uses
`--with-deps`). With Foundry 1.7.1 available, `npm run validate` runs type checking,
Solidity formatting and tests, Node tests, the static build, the three-chain Anvil
demo integration test and Chromium UI regression tests. GitHub Actions runs this
same command. The demo uses committed ZK proof fixtures.

`make test` additionally runs `npm run test:integration`, which generates fresh ZK
proofs and requires compatible `nargo` and `bb` executables. CI's prototype checks
do not replace this real-prover validation or a security audit.
