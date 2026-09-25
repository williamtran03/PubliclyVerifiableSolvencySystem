# Published ledger

The arm without cryptographic proofs: the exchange publishes every (pseudonymous)
liability part on-chain, and `MerkleSumRegistry.sol` rebuilds the merkle-sum tree
from calldata, so no total has to be taken on trust. Privacy comes only from
splitting balances into parts, shuffling them and hiding identities behind salted
commitments; the amounts themselves are public.

## Layout

| Path | What it is |
| --- | --- |
| `contracts/MerkleSumRegistry.sol` | One tree per asset, rebuilt on-chain; each asset's total checked against approved reserves of that asset |
| `prover/tree.ts` | Keccak merkle-sum tree; byte-matches `computeRoot` in the contract |
| `prover/splitLiabilities.ts` | Splits customers into salted, shuffled parts per asset; customer and public-ledger checks |
| `cli/verify.ts` | `npm run ledger -- build / audit / verify` |
| `script/demo.ts` | Anvil walkthrough (`make ledger-demo`) |
| `fixtures/customers.example.json` | Fake customers: parts with an asset id and an amount in base units |

Reserve control and roles come from `shared/contracts/ReserveRegistry.sol`: the
company proposes a wallet, the wallet signs an EIP-712 message (relayable, ERC-1271
for multisigs), the auditor approves it. Only approved wallets count.

## Leaf and identity encoding

    leaf     = keccak256(abi.encode(identity, amount))
    parent   = keccak256(abi.encode(left.hash, left.sum, right.hash, right.sum))
    identity = keccak256(abi.encode("solvency.split.v2", snapshotId, customerId, name,
                                    dateOfBirth, assetId, partIndex, salt))

Each asset has its own tree, padded with zero leaves to a power of two; an asset
nobody holds has an empty ledger with root and total 0. Amounts are in the asset's
base units (wei for ETH), so reserves and liabilities compare exactly, with no price
and no rounding.

## Build, audit, verify

    npm run ledger -- build arms/published-ledger/fixtures/customers.example.json <new dir> 2
    npm run ledger -- audit <dir>/ledger.json
    npm run ledger -- verify <registry> <rpc url> <dir>/private/customer-0.json alice 0:100 1:3

`build` writes the public `ledger.json` and one private bundle per customer; publish
only the former. `verify` takes the customer ID and one `assetId:amount` per asset from
the customer's own records, reads the latest epoch from the registry, and checks every
part's identity opening and path, rejecting duplicate parts, parts moved to another
asset's tree and omitted parts or assets.

## Demo

    anvil --silent &
    forge build
    make ledger-demo

Deploys the registry for ETH and a mock token, runs the reserve flow, submits a ledger,
checks the TypeScript and Solidity roots agree and every customer verifies, then shows
a ledger short in one asset being refused despite a surplus in the other.

## Limits

Does not discover undisclosed customers or loans, lock reserves, or enforce ledger
freshness. Splitting and shuffling do not guarantee anonymity, and inclusion proofs
reveal sibling subtree totals. A valid submission is not complete proof of solvency.
