# Case 5: model, guarantees and limitations

This is an educational, ETH-only custodian prototype, not an audited financial
product. The branch's proof-backed vault is the public verifier entry point.
The original `SolvencyRegistry` remains a labelled legacy baseline: its liabilities
are unchecked, so it must not be presented as the completed proof system.

## Accounting boundary

- Unit: integer wei. No prices, currency conversions or token balances.
- Eligible assets: native ETH actually held in this particular vault at
  `beginSnapshot`. This avoids arbitrary reserve lists, duplicated addresses,
  fabricated asset totals, and token/address ownership ambiguities.
- Recognized liabilities: exactly four private records representing the chosen
  ledger snapshot. A record can include other recognized debt. Unused records use
  distinct opaque IDs and zero balances. The operator must provide customers with
  their expected opaque ID and correct balance through the account service.
- Coverage: the sum of these records is no greater than the captured ETH balance.
  There is no promise of future solvency or instant withdrawal liquidity.

The Solidity code determines the assets; the prover cannot choose them. The
operator starts a snapshot by committing the liability dataset and total.
The contract captures assets, block number and timestamp in that transaction.
Withdrawals are disabled until verification or cancellation after one day.
Deposits during proving do not increase the old snapshot's asset total.
Anyone may submit the proof. Only the owner may start snapshots or withdraw.
History is retained, including cancelled snapshots. A valid proof cannot be used
for another epoch, chain or vault. A verified historical snapshot is not a live
financial health indicator.

The customer's inclusion check MUST use the commitment from a verified on-chain
snapshot, not an arbitrary root/commitment packaged with the proof. The customer
also compares their ID and balance with independent account records. The CLI
accepts an independently pinned public snapshot file for this purpose; it does
not authenticate a supplied file by itself. Private customer proof files must
be delivered only to the corresponding customer.

## Adversarial analysis

1. **Omitted customer or unreported loan:** still possible. A customer can detect
   a missing/wrong inclusion proof if they actively check, but absence of a proof
   does not itself identify why the service failed. Off-chain books need
   reconciliation, auditors or independently signed counterparty statements.
2. **Negative balance or field wraparound:** the ZK circuit constrains unsigned
   64-bit balances and a 128-bit total. The SNARKless branch proves 16-bit ranges
   with polynomial identities and bounds degrees. Host-side validation alone
   is insufficient; adversaries can bypass it.
3. **Borrowed reserves:** depositing borrowed ETH inflates visible assets unless
   the loan also appears in recognized liabilities. Control of ETH does not
   establish that it is legally unencumbered. The prototype has no oracle for this.
4. **Snapshot dressing:** reserve locking prevents a withdrawal during this proof
   cycle. It does not prevent temporary borrowing before the snapshot or movement
   between different custodians over time. This vault has a fixed accounting
   boundary, not a global double-counting registry.
5. **Fake verifier/setup:** users must inspect/pin the contract, verification key
   and (where applicable) ceremony parameters. A malicious verifier returning
   `true` cannot be excluded by checking that an address has bytecode.
6. **Selective distribution/censorship:** producing customer proofs in a batch
   reduces demand-based profiling but does not force an operator to deliver them.
   The account service needs a complaints/reconciliation process; this prototype
   does not impose an automatic financial penalty.

## Tests and deployment scope

The default demo executes actual compiled Solidity in an in-memory Cancun EVM,
including the curve precompiles. It uses real cryptographic proofs, not a mock
verifier. Mutation, inclusion, insolvency, replay and snapshot-lock tests are
part of the demo. Foundry remains configured for Solidity 0.8.28/Cancun; the
TypeScript EVM suite also runs where native Foundry binaries are unavailable.
The local RPC helpers use viem ABI encoding and restrict themselves to localhost
chain 31337. No mainnet or public-testnet deployment is performed by these scripts.

Repeated snapshots reveal aggregate reserve/liability changes, timing and
commitment changes. They cannot establish uninterrupted solvency between proofs.

Source: the attached Case 5 description, especially its distinction between
observable assets and self-reported liabilities.
