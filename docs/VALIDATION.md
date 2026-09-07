# Validation record

Validated on 2026-09-07 with Node 24, Solidity 0.8.28 and the committed dependency versions.

- TypeScript type checking: passed.
- Branch test suite: 5/5 passed.
- Real proof generation and cryptographic verification: passed.
- Actual compiled Solidity in a Cancun EVM, including BN254 precompiles: passed.
- Snapshot finalization, withdrawal lock, rejected malformed proofs and replay: passed.
- Customer identity/balance inclusion and tampered membership: passed.
- Circuit rejects false totals, insolvency, negative/overflowing balances, duplicate IDs, changed salt and snapshot context.
- Solidity verifier rejects changes to every public input.

Observed execution gas for vault proof submission: 2,231,073.
This is the EVM call execution cost from the in-memory test harness; it excludes
transaction intrinsic/calldata gas and is not a production gas quotation.

Customer CLI preparation and verification were also exercised locally. Private
witnesses, customer files, CRS caches and demonstration SRS files are excluded
from the commits. The generated ZK Solidity verifier is public circuit material.

No public-chain deployment, production SRS ceremony or security audit was performed.
The localhost Anvil helpers are supplied; the automated end-to-end execution used
the in-memory EVM. Separate branch tests used the exact already-installed dependency
set after a new offline lockfile-resolution command was blocked by the environment.
No fresh npm-ci install is claimed as part of this validation.
