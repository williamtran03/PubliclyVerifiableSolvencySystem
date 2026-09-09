# Merkle-sum integration

Integrated from merklesumtree-solution onto main 10df3b4. Existing salted
Poseidon2 leaves, the eight-slot Noir circuit, HonkVerifier, SolvencyRegistry,
KZG code and proof fixtures are preserved. This merge does not change the
circuit or verification key. A new ledger still needs a new proof.

## Two compatible paths

| Mode | Hash / capacity | Contract | Disclosure |
| --- | --- | --- | --- |
| ZK-compatible split balances | Poseidon2 / eight parts total | SolvencyRegistry | Root and total public; witness and parts private |
| Public Merkle-sum alternative | Keccak / 256 parts maximum | MerkleSumRegistry | Commitments and partial amounts public |

The public alternative lives under prover/merkle-sum/. Its contract is independent
of the Honk registry, so neither the new constructor nor submitEpoch can bypass
the existing ZK check. It computes root and total itself and rejects zero/duplicate
reserve addresses, repeated snapshot IDs, overflow and unverified submissions.

## ZK-compatible split balances

Each customer's amounts array becomes shuffled leaves with independent random
32-byte nonces. A domain-separated ABI encoding of snapshot ID, customer ID,
name, birth date, part index and nonce is hashed with Keccak and reduced modulo
the BN254 scalar field. This commitment occupies the EXISTING salt field:

    leaf = Poseidon2(customerIdAsField, saltCommitment, partialAmount)
    parent = Poseidon2(left.hash, left.sum, right.hash, right.sum)

Keccak is evaluated outside Noir. The unchanged circuit binds the salt value and
proves tree arithmetic and non-negative u64 amounts. The customer verifies the
identity opening locally. Neither the circuit nor this opening authenticates KYC,
ledger freshness or disclosure completeness. Snapshot IDs bind private context;
they do not establish an on-chain snapshot time.

Eight slots means eight parts across all customers. Names/birth dates may be
empty if unnecessary. The example is Alice 40 + 60 wei and Bob 20 wei, not ETH.

## Build and verify

From the repository root:

    npm run merkle -- build-zk fixtures/split-customers.example.json merkle-output

Use a new output directory each time. The result contains public epoch.json,
private/Prover.toml and one private/customer-N.json bundle per customer. Never
publish the private directory or put it in frontend/public.

Copy the generated private/Prover.toml to circuit/Prover.toml and run nargo execute
followed by main's bb write_vk/prove/verify commands directly. Do NOT run
make fixtures or make circuit-prove for these inputs: they rebuild the baseline
CSV and overwrite the split witness. Submit the resulting proof with the matching
split epoch.json root and total to the existing SolvencyRegistry. The baseline
fixtures/proof.bin cannot prove a newly generated split root.

    npm run merkle -- verify-zk <registry> <rpc-url> merkle-output/private/customer-0.json 100 alice

The customer supplies their expected ID and full balance from independent
records. Verification checks all identity openings and paths, rejects duplicate
part indices and leaf positions, matches both root and total on-chain, and sums
the parts against the expected full balance. Omitted nonzero parts fail.

The existing frontend/ also accepts private Poseidon2 split bundles: connect to
the registry, select the local file, enter the expected ID and full balance, then
click Verify all my parts. No bundle upload occurs. This uses the same
prover/splitProof.ts verifier as the CLI. The separate website branch is unchanged.

## Public Keccak alternative

    npm run merkle -- build fixtures/split-customers.example.json merkle-output
    npm run merkle -- audit merkle-output/ledger.json
    forge build
    npm run demo:merkle

Run your own disposable local Anvil instance on port 8545 before the demo.
It uses the PUBLIC Anvil development key. Deploy MerkleSumRegistry with reserve
addresses and call submitLedger(snapshotId, identities, amounts). The contract
recomputes root/total and compares ETH reserves. All partial amounts are public
in transaction calldata. This is not a ZK proof.

    npm run merkle -- verify <merkle-registry> <rpc-url> merkle-output/private/customer-0.json 100 alice

## Limits

Neither mode discovers undisclosed loans/customers, proves reserve ownership or
eligibility, locks reserves, or enforces ledger freshness. Splitting/shuffling
does not guarantee anonymity. Inclusion proofs reveal sibling subtree totals.
A valid proof of submitted records does not establish complete solvency.

## Validation

    npm run test:prover
    forge test
    npx tsc --noEmit
    npx vite build

Validated: 33 TypeScript tests, 13 Foundry tests including the existing real Honk
proof fixture and KZG verifier, frontend production build, and execution of the
unchanged Noir circuit with split inputs producing the same root/total as TS.
The build/audit CLI paths were exercised. No new split ZK proof was generated
or submitted to a deployed registry during this merge.

Validation used isolated tools: Node 24, TypeScript 5.9.3, Vite 7.3.1, Foundry 1.7.1,
Solidity 0.8.28, viem 2.56.3, Poseidon2 0.6.2 and noble-curves 1.9.1.
Main's declared TypeScript/Vite ranges and lockfile were preserved; a fresh
installation of those ranges was not part of this validation.
