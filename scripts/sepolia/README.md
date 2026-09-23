# Sepolia deployment

`npm run sepolia` deploys the three arms to Sepolia and publishes their epochs. It uses the
same contracts, customer set and provers as the local demo, with real keys, the live
Chainlink feeds and the ceremony SRS. Deployment reads the recorded addresses and
on-chain reserve state to skip completed steps. The operations drill saves resumable
checkpoints. Epoch publication creates the next epoch on each successful invocation,
so running it again publishes another epoch. After an interruption, run the same
command again: it first recovers the transaction that was in flight (see *Recovery*
below).

## What gets deployed

| Contract | Notes |
| --- | --- |
| `ReserveDirectory` | One for the chain. It gives each reserve wallet to one registry at a time, so each arm has its own reserve key. |
| `BTC`, `WETH`, `USDC`, `TEST` | `DemoAsset` test tokens (8, 18, 6 and 0 decimals). Minting is unrestricted, so these reserves show the mechanism, not real backing. |
| `RelationsLib`, `ZKTranscriptLib`, `HonkVerifier` | The generated UltraHonk verifier for the committed circuit. |
| `MerkleSumRegistry` | Arm 1. Assets are native ETH and `TEST`, with the ledger fixture's customers (120 wei and 3 TEST). |
| `MultiAssetSolvencyRegistry` | Arm 2. BTC, WETH and USDC, priced by the Chainlink BTC/USD, ETH/USD and USDC/USD feeds. |
| `KzgSolvencyRegistry` | Arm 3. `TEST` with 0 decimals, the shared `customers.csv`. |

The ZK arm holds ETH as a `WETH` test token, not native ETH, because `customer-456` is
owed 10.25 ETH. That is more than Sepolia faucets hand out. The ledger arm still covers the
native-ETH path.

Before deploying, the script checks each feed's `description()` and `decimals()` on chain.
The price limits (`maxPriceAge`) are 2 hours for BTC and ETH and 2 days for USDC. On
Sepolia the first two update about every 3,630 to 3,700 s and USDC about every 86,430 s,
so the demo's 1 h and 24 h limits would sometimes reject a correct submission.

## 1. Keys

The script needs five different keys. Create them with `cast wallet new --number 5`,
then copy `.env.example` to `.env` (gitignored) and fill it in:

| Variable | Role | Needs Sepolia ETH |
| --- | --- | --- |
| `COMPANY_PRIVATE_KEY` | Deploys everything, submits epochs, funds and mints the reserves | yes, about 0.1 ETH (see below) |
| `AUDITOR_PRIVATE_KEY` | Approves reserve wallets, samples balances | yes, about 0.01 ETH |
| `LEDGER_RESERVE_PRIVATE_KEY`, `ZK_RESERVE_PRIVATE_KEY`, `KZG_RESERVE_PRIVATE_KEY` | Reserve wallets. Normally only sign; the company relays the signature. The operations drill temporarily uses them as role holders | no faucet funding; the drill funds their transactions |
| `SEPOLIA_RPC_URL` | Any Sepolia HTTPS RPC. It is never written to the record, so it may contain an API key | |

Optional settings: `MAX_EPOCH_AGE` (default 604800 s, 7 days, after which the site shows
the snapshot as expired), `MIN_EPOCH_INTERVAL` (default 60 s), `PRIVATE_OUTPUT`
(default `~/opensolvency-sepolia`, must be outside the repository) and `DEPLOYMENT_FILE`
(default `deployments/sepolia.json`). The two schedule values are fixed at deployment.

Request faucet ETH early, because faucets are rate-limited. A dress rehearsal on an Anvil
fork of Sepolia used 28.4M gas for the deployment and 6.9M gas for each epoch across all
three arms, which is 0.028 ETH and 0.007 ETH at 1 gwei. Sepolia gas prices spike, so
fund the company with a margin.

## 2. Deploy

```shell
npm run sepolia -- deploy
```

This deploys the contracts, funds and mints each reserve, then proposes, proves and
approves it. Addresses, deployment blocks and the gas of every transaction go to
`deployments/sepolia.json`. That file holds only public data, and the website reads it
(see below). Commit it once the deployment is final.

## 3. Publish an epoch

```shell
npm run sepolia -- epoch                 # all three arms
npm run sepolia -- epoch zk-circuit      # or any subset
```

For each arm, the script follows the registry's order:

1. The reserve wallet re-proves control for the current window. If the auditor had
   sampled before that, the sample is discarded, because it counted the wallet as zero.
2. The auditor samples the reserves.
3. The script waits for the next block. Submission needs a sample from an earlier block.
4. The script builds the epoch and submits it:
   - **Ledger:** splits and shuffles the ledger, then submits it.
   - **ZK:** reads the snapshot, proves with `nargo` and `bb`, then submits with the
     latest round IDs.
   - **KZG:** binds the transcript to the registry and epoch, then submits.
5. The script reads the new epoch through the website's own adapters and verifies every
   customer's bundle. It also checks that a balance one unit higher fails.

Before sending any epoch transactions, the command checks the required proving versions
when the ZK arm is selected. The ZK arm needs `nargo` 1.0.0-beta.26 and `bb` 6.0.0-nightly.20260902, the versions the
committed verifier was generated with. Customer bundles go to
`PRIVATE_OUTPUT/<arm>/epoch-<n>/`. Hand them out privately and never commit them.

A registry accepts the next epoch only `MIN_EPOCH_INTERVAL` after the last one. The
script stops early and prints when it opens.

```shell
npm run sepolia -- status               # balances, epochs, freshness, when the next epoch opens
```

## 4. Exercise role transfer and reserve removal

On this test-token deployment, run the explicit operations drill, then publish a
fresh epoch:

```sh
npm run sepolia -- exercise             # or a subset of arms
npm run sepolia -- epoch
```

The drill transfers the company role to that arm's reserve wallet and back, then
transfers the auditor role to the same wallet and back. Each transfer uses both
nomination and acceptance. The company funds that wallet for the four transactions
it must send (a 200,000-gas budget at the estimated maximum fee); this is additional
to the deployment/epoch budget above. The original company and auditor are restored.
The reserve temporarily controls a role: use this only for the test-token rehearsal,
with all five keys controlled by its operator.

Next it removes the reserve, checks that the shared directory released its claim,
and proposes, proves and approves it again. It discards any current sample so the
next epoch takes a fresh sample. The drill leaves the small unused ETH balance in
the reserve wallet. It does not publish an epoch itself.

Receipts and per-arm checkpoints are saved in `deployments/sepolia.json` under
`transactions` and `operations`. Re-run `exercise` after an interruption; it reads
the on-chain state before repeating a step. Keep the original `.env` keys throughout,
including while a reserve wallet temporarily holds a role. `deploy` and `epoch`
refuse to run while a drill is incomplete. A completed drill is skipped on rerun.
Do not manually edit checkpoints or concurrently operate the same registries.

The local three-arm integration test exercises this code with interruptions after
mined transactions. This is local validation; only actual Sepolia receipts establish
that the drill has been performed on the testnet.

## Website

`npm run web` and `npm run web:build` pick up every complete record in `deployments/*.json`.
The site then shows a **Use Sepolia deployment** button that fills in all three registries,
with the public RPC `https://ethereum-sepolia-rpc.publicnode.com`, and links each registry
to Sepolia Etherscan. Users can still change the RPC. That RPC limits `eth_getLogs` to
50,000 blocks, so the ledger view finds the submission block by its timestamp. For the
company view, the wallet is asked to switch to the RPC's chain.

To check a customer, use the files in `PRIVATE_OUTPUT`. The secrets and balances are the
same as in the local demo (`scripts/demo/README.md`).

## Before the first real run

Still outstanding (2026-09-22):

- Fund the company and auditor, check RPC access, and install the pinned proving tools
  on the machine that runs `epoch`. The version check does not install them.
- Deploy, publish epochs and run `exercise` on public Sepolia, then publish a fresh
  epoch after the drill.
- Commit the resulting public `deployments/sepolia.json`, rebuild the site, choose a
  host and publish `open-solvency/dist/`. Never publish `.env` or private bundles.

Already checked on 2026-09-22 with the pinned tools: `bb write_solidity_verifier`
regenerates `MultiAssetHonkVerifier.sol` byte for byte from the committed circuit, and
`npm run test:integration` passes with fresh proofs. On a Sepolia fork pinned at block
11,759,567 (see *Rehearsal and measurements*), `deploy`, two `epoch` rounds and `exercise`
all succeeded, and so did the recovery below after the process was killed mid-submission.

### Recovery

Transactions are prepared and signed locally. The signed transaction, its hash,
sender, nonce and (for publication) epoch ID are saved atomically to the deployment
record **before broadcast**. If the process stops before or after broadcast, the next
`deploy`, `epoch` or `exercise` checks that exact hash and rebroadcasts the same signed
transaction when necessary. It never invents a new transaction for an uncertain outcome.

The receipt, deployment address or epoch entry, and removal of `pending` are saved in
one atomic record replacement. If that write fails, the persisted pending entry remains
available for recovery. Epoch metadata is gathered before replacing the record.

A consumed nonce without the expected receipt requires manual investigation of a
possible replacement. Old hash-only pending entries can still recover mined receipts;
an unmined legacy entry is retained for manual resolution. RPC errors retain the journal.
Other pending transactions from the role wallets block further work. Do not operate the
same keys or registries concurrently.

Only commit a completed deployment record with no `pending` entry. While pending,
the record contains a signed transaction that can be broadcast by anyone who reads it;
keep that working record local until recovery is complete. It never contains private keys.

Epoch bundles are written to `PRIVATE_OUTPUT/<arm>/epoch-<n>.pending/` **before** the
submission is sent, then renamed to `epoch-<n>/` once it is mined. On the next `epoch`
run, a leftover `.pending` folder is renamed if epoch `n` is on chain and deleted if it
is not. A folder named `epoch-<n>` therefore always holds the bundles of a published
epoch. A recovered epoch is not re-verified through the site adapter, because the
adapter reads only the latest epoch.

The deployment JSON is replaced atomically, so a reader sees either the previous
complete record or the new one. There is no lock against concurrent writers: run one
command at a time.

### Rehearsal and measurements

- Rehearse on a fork. Start
  `anvil --fork-url <sepolia rpc> --port 18545 --block-time 12`, point `SEPOLIA_RPC_URL`
  at `http://127.0.0.1:18545` and `DEPLOYMENT_FILE` at a scratch path, and fund the two
  role keys with `cast rpc anvil_setBalance`. The fork keeps chain ID 11155111 and the
  real feeds.
- Pin the fork (`--fork-block-number`) so the receipts can be reproduced and traced
  with `cast rpc debug_traceTransaction <hash> '{"tracer":"callTracer"}'`.
- Read [the gas reconciliation](../../docs/comparison.md#sepolia-rehearsal-versus-fixture-probes)
  before comparing receipts with the `forge test` figures. It accounts for the test
  storage reads, the transaction overhead, and the MODEXP repricing that Fusaka applies
  to the ZK verifier. Public Sepolia measurements must cite the recorded transaction
  hashes.

## Decisions before publication

The team discussion checklist is in [open-decisions.md](../../docs/open-decisions.md).
