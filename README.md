# Case 5 — SNARKless polynomial solvency prototype

Branch: `snarkless`. TypeScript + Solidity/EVM; Summa V2-inspired KZG polynomial commitments, with explicit degree and balance-range verification.

## Run the complete demonstration

Use Node 24 or newer:

```sh
npm ci
npm run demo
```

This type-checks the code and runs the legacy tree tests plus the new proof-backed
integration tests. The new tests deploy compiled Solidity in an in-memory Cancun
EVM, fund a vault, construct a real proof, check customer membership, reject
malformed/false claims and replay, and finalize a snapshot. It does not mock the
cryptographic verifier and needs no running RPC server. It generates a fresh single-party SRS for local testing only.

`npm run build` exports compiled ABIs and bytecode to `artifacts/contracts`.
The existing Foundry configuration is retained. Solidity is pinned to 0.8.28 with
optimization and Cancun; TypeScript communicates with Solidity through viem ABIs.

## Scope

A fictional ETH custodian holds eligible reserves in its own proof-backed vault.
Four private records have unsigned 16-bit wei balances (0–65,535 each).
The contract captures actual vault assets at `beginSnapshot`, locks withdrawals
while proving, and retains verified/cancelled snapshot history. Customers check
their own inclusion against the verified public commitment.

This is a bounded teaching prototype, not a production or audited solvency service.
Unreported off-chain debts and incomplete customer books remain outside what
cryptography can establish. The demonstration SRS is not production-secure; ordinary KZG is not a hiding commitment and this entire protocol is not claimed to be zero knowledge.

Read [accounting and threat model](docs/CASE5.md) and
[polynomial protocol, setup and privacy](docs/SNARKLESS.md).

## Work with your own example records

The four example IDs and balances in `examples/records.json` are fictional.
Replace `examples/context.json` with the actual vault address, next epoch, chain
and expected captured assets. All amounts and field elements are integer strings.

```sh
npm run setup:demo -- artifacts/demo-srs.json
npm run prove -- examples/records.json examples/context.json artifacts/demo-srs.json artifacts/my-snapshot
npm run verify -- artifacts/my-snapshot/public.json artifacts/demo-srs.json
npm run verify:customer -- artifacts/my-snapshot/customer-0.json artifacts/my-snapshot/public.json artifacts/demo-srs.json
```

The SRS used by the prover and verifier must be identical and independently pinned.
A real system requires a reviewed multiparty ceremony. Never let a custodian choose
fresh verification parameters with each claim. This version includes masked bit
polynomials and degree witnesses beyond the introductory Summa V2 description.

The public file must be independently matched to the deployed vault's verified
snapshot. Merely accepting a file delivered with the customer's proof is not a
trustworthy commitment check. The customer compares the reported ID/balance with
their own account records.

## Optional local Anvil deployment

1. Start `npm run anvil` in another terminal.
2. Set `PRIVATE_KEY` to a local Anvil development key. `RPC_URL` defaults to localhost.
3. Run `npm run deploy:local -- artifacts/demo-srs.json`. The helper deploys
   the verifier, then the vault, and writes
   `local-deployment.json`.
4. Fund the vault with local test ETH. Set the snapshot context to its actual
   address and intended balance, then prepare/prove as above.
5. Start the snapshot with
   `npm run submit:local -- begin <vault> <epoch> artifacts/my-snapshot/public.json`.
   Confirm the captured on-chain assets match the inputs; otherwise regenerate.
6. Submit
   `npm run submit:local -- submit <vault> <epoch> artifacts/my-snapshot/public.json`.
   A successful transaction finalizes the immutable snapshot.

Only localhost chain 31337 is accepted by these helpers. Proofs are bound to that
specific vault/chain/epoch. Anvil deployment helpers are supplied, while the automated
execution evidence comes from the in-memory EVM tests.

## Layout

- `contracts/SnapshotVault.sol`: shared asset capture and snapshot lifecycle.
- `contracts/SnarklessSolvencyVault.sol`: proof-backed registry.
- `snarkless/`: TypeScript interpolation, KZG, range proofs and customer tools.
- `testing/evm.ts`: real EVM deployment, bytecode linking and verification harness.
- `cli/`: local deployment and submission helpers.
- `docs/`: privacy, trust assumptions and accounting manipulations.

`contracts/SolvencyRegistry.sol` and `prover/` are the preserved legacy baseline.
The old registry accepts unproven liability totals; use the new vault for this case.
