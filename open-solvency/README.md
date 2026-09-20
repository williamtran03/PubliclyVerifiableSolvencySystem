# OpenSolvency website

Start with `npm run web` from the repository root. Run `npm run web:build` for a static production build in `open-solvency/dist/`. For a complete local deployment with all three arms, use `npm run demo`; the launcher starts three isolated Anvil chains and the website, then exposes only their connection details at `/demo-config.json`.

The site has a public customer view and a company view. Select **Merkle-Sum Tree** (`arms/published-ledger`), **ZK circuit**, or **KZG** first; each adapter reads the matching registry contract. The Merkle-Sum implementation uses one tree per asset and publishes the pseudonymous ledger so the contract can recompute every root and sum. The selected RPC and registry are remembered separately for each arm. They are user supplied because the three registries are separate contracts and deployments.

## Customer

1. Select the implementation and load the current on-chain snapshot.
2. Obtain your own JSON inclusion proof through a private channel. Enter your account ID and balances in base units from independent account records.
3. For ZK or KZG, enter your account secret. For KZG, save only your own object from `inclusion.json` as a JSON file, not the full array.
4. Select the file and run the check. The site reads the current epoch again before verifying, so a changed epoch requires a reload.

ZK and published-ledger verification runs in the browser. KZG invokes the registry's `verifyInclusion` through the configured RPC: identity commitment, claimed balance, proof point and index are visible to the RPC operator. The JSON file itself is never uploaded by the site. No wallet is required for customers.

## Company

Generate the ledger and proofs with the arm's existing CLI or Foundry workflow. The website does not ingest raw customer records or generate ZK/KZG proofs. The **compare** action checks an already published epoch artifact against the current on-chain snapshot. To publish the next epoch, select the new artifact and the required supporting proof:

| Arm | New artifact | Supporting input |
| --- | --- | --- |
| Merkle-Sum Tree | `ledger.json` from `npm run ledger -- build` | none |
| ZK circuit | `epoch.json` from `make zk-fixtures` | `proof.bin` from `make zk-prove`; three oracle round IDs |
| KZG | `epoch.json` from `make kzg-epoch` | `range-proof.json` |

The site checks the artifact against the selected register where possible, simulates the contract call and requests confirmation from the browser wallet. The wallet must be on the same chain as the RPC and hold the contract's company role. A successful wallet response is a **submitted transaction**, not a confirmed epoch; reload after it is mined. Do not add private bundles, witness files, account salts or internal ledgers to the static site.

## Legacy demo site

The former `demo-site/` has been removed. It published customer bundles under predictable URLs, so it is not part of the supported website path anymore. `open-solvency/` accepts private proof files from the browser instead.

## Limits

These implementations prove claims about submitted records and reserve balances at a point in time. They do not detect omitted liabilities, prove that reserves remain available later, or substitute for an independent financial audit. The company interface relies on the smart contract's `onlyCompany` restriction and a wallet; it has no browser-side password.

## Deployment and validation

See [deployment status](../docs/deployment.md) for static hosting instructions and
remaining production requirements. Run `npm run validate` for the prototype
checks, including browser and three-chain demo tests.

When historical ledger retrieval is unavailable, the site still loads the snapshot
and verifies customer proofs. Select the public `ledger.json` in the fallback
section to display a tree after its entries have been checked against the on-chain
roots and totals. This also supports ledgers published through contract wallets.
