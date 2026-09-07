# ZK branch: Noir + Barretenberg + TypeScript + Solidity

## Statement

Noir's circuit takes private IDs, fresh nonzero salts and four unsigned 64-bit
balances. It rebuilds all four salted leaves and all three internal Merkle-sum
nodes, checks distinct IDs, and constrains the total and coverage inequality.
Checking just one membership path would not establish the total's correctness.

Public input order is fixed:
`[root, totalLiabilities, capturedAssets, epoch, chainId, vaultAddress]`.
`ZkSolvencyVault` constructs this array from storage and chain context, never from
untrusted caller-provided public inputs. Amounts are integer wei; `u128` is used
for the sum so four maximum `u64` balances cannot overflow it.

Leaves: Poseidon2 sponge over `[1, epoch, chain, vault, id, salt, balance]`.
Internal nodes: sponge over `[2, leftHash, leftSum, rightHash, rightSum]`.
The sponge uses rate 3 and capacity 1 with IV `length * 2^64`. Input lengths 5 and
7 are matched by the TypeScript Barretenberg hash function. The circuit calls the
standard Poseidon2 permutation; the integration test verifies the exact match.
This is deliberately separate from the legacy Keccak tree.

Proof generation uses Barretenberg's `verifierTarget: 'evm'`, which enables ZK.
It does not use `evm-no-zk`. The generated Solidity includes linked libraries;
the deployment helpers deploy and link them before deploying `HonkVerifier`.
No Rust application code is required. Noir source is not TypeScript, while all
orchestration, witness preparation and blockchain calls are TypeScript.

## Privacy

The public learns assets, total liabilities, capacity (four slots), context,
commitment and verification outcome. It does not receive IDs, salts or balances.
Fresh high-entropy salts prevent simple leaf dictionary attacks. Reuse of salts
across unrelated snapshots is discouraged. Normal customer Merkle-sum paths
reveal sibling subtree sums (one sibling is an individual balance in this tiny
tree), but not the identity/salt behind those hashes. They are not ZK inclusion
proofs. This tradeoff is explicit: use a separate ZK inclusion circuit if even
that aggregate/sibling disclosure is unacceptable.

`artifacts/` is ignored by git. Witnesses and customer files are local secrets;
the generated Solidity verifier contains only public circuit-specific material.
No proof of ledger completeness or off-chain encumbrances is implied.

## Reproducibility

Pinned package versions and the npm lockfile define the toolchain. The compiler
runs as WASM through `@noir-lang/noir_wasm`; no nargo/Rust installation is needed.
`npm run generate:verifier` compiles the circuit, creates a real test proof,
checks it off-chain and regenerates `contracts/generated/NoirVerifier.sol`.
The first proof run downloads Barretenberg's CRS; retain `artifacts/crs` locally
to avoid repeating the download. Do not substitute an unreviewed CRS.

References:
- https://noir-lang.org/docs/
- https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/
- https://github.com/noir-lang/noir/blob/v1.0.0-beta.26/noir_stdlib/src/hash/poseidon2.nr
