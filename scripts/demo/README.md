# Reproducible local demo

From the repository root, install the locked dependencies with `npm ci`, then run `npm run demo`. Node 22+ and Foundry (`forge`, `anvil`, Solidity 0.8.28) are required. The committed ZK proof avoids a Noir/Barretenberg installation for this walkthrough. KZG proofs are generated locally for the deployed registry, using the SRS that `make kzg-setup` extracts from the Perpetual Powers of Tau ceremony.

The launcher builds contracts and starts three isolated Anvil nodes plus OpenSolvency:

| Arm | RPC | Chain ID |
| --- | --- | --- |
| Merkle-Sum Tree | http://127.0.0.1:8545 | 31338 |
| ZK circuit | http://127.0.0.1:8546 | 31337 |
| KZG | http://127.0.0.1:8547 | 31339 |

The website is at http://localhost:5175/. Registry addresses and the private output directory are printed at startup. The local demo connection endpoint exposes only RPCs, registry addresses and chain IDs. Bundles and secrets are never served by it.

Occupied ports cause startup to fail without touching existing processes. To run alongside another demo, use `DEMO_BASE_PORT=9545 DEMO_WEB_PORT=6175 npm run demo`. Ctrl+C terminates only the processes created by the launcher, including during startup. Logs and artifacts remain in the printed temporary directory. `DEMO_OUTPUT` may select a new or empty directory outside the repository; output inside the Vite source tree is refused.

## Customer checks

Select the arm, load its snapshot, and open the corresponding local file. Amounts below are proof units; the UI also supports token amounts when unit metadata is available.

| File | Account | Proof units | Secret |
| --- | --- | --- | --- |
| `ledger-alice.json` | `alice` | asset 0: 100; asset 1: 3 | none |
| `zk-customer-123.json` | `customer-123` | asset 0: 250000000 (2.5 BTC) | 84731920475619283746152039485761029384 |
| `kzg-customer-123.json` | `customer-123` | asset 0: 12550 | 84731920475619283746152039485761029384 |

Changing a balance by one proof unit must fail. A valid inclusion proof still verifies mathematically after the epoch expires, but the UI must label it expired.

## Company checks

The launcher uses public Anvil keys, local demo tokens and price feeds; none of these are production credentials or market data. Import Anvil account 0 into a development wallet and select the matching RPC and chain ID. The contract enforces the company role.

* Merkle-Sum: submit `ledger-next.json`, reload, then verify `ledger-next-alice.json`.
* KZG: submit `kzg-next-epoch.json` with `kzg-next-range-proof.json`, reload, then verify `kzg-next-customer-123.json`.
* ZK: the committed proof publishes epoch 0 during startup. Reusing it for epoch 1 must fail. A new epoch requires a new snapshot, witness and ZK proof from the existing prover tools.

## Separate arm commands

`make ledger-demo`, `make zk-demo` and `make kzg-demo` deploy to already running local Anvil nodes on ports 8545, 8546 and 8547 respectively. Override with `RPC_URL`. They print their registry and write artifacts outside the repository. The ledger and KZG paths use normal deployments on any local Anvil chain; KZG generates a fresh transcript for the actual address. No `anvil_setCode`, storage copying or fixed-address impersonation is used.

The three contracts can coexist on a chain when proofs are generated for their actual deployments. The isolated demo is necessary to reuse the committed ZK fixture: it binds chain ID 31337, epoch 0 and the deployment address at company nonce 8. `make zk-demo` therefore refuses a non-fresh company nonce before sending any transaction. The other two nodes have distinct IDs to prevent wallet confusion.

## Regression checks

`make test-demo` starts disposable nodes on free ports, executes the same deployment functions as the CLI, runs the site's three verification adapters against real contracts, rejects incorrect balances and submits the prepared ledger/KZG next epochs. It also checks the site's public connection endpoint. Nodes are stopped after success or failure. This supplements the existing unit and full ZK prover tests.
