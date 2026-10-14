# KZG Sepolia migration — 14 October 2026

The snarkless registry now uses the blinded running-sum liability argument introduced
in commit `23dbcb883136e8268ee9f44f1334e47ff48fdfa9`. The published-ledger and
ZK-circuit registries, their reserves and their published epochs are unchanged.

- New registry: [0x754f955746B95bDA358e275Bc376CF549e160f86](https://sepolia.etherscan.io/address/0x754f955746B95bDA358e275Bc376CF549e160f86).
- Deployment: [transaction](https://sepolia.etherscan.io/tx/0x8594ac35deaff5e2b0da5aac1b654ad069e4efc815caa713bdcca2747e595fa1), block 11,913,017.
- New reserve: `0xFf899d40522F5EF8f6372c4ea4Bb99e5dfD777Ae`, funded with 50,000 TEST,
  proved and approved by the existing auditor.
- Epoch 0: [transaction](https://sepolia.etherscan.io/tx/0x0c97a6e5a68cb97c696f394a7cc9ece19f4c3b9fb19e72e11cc5ff277e86bd01), block 11,913,028,
  submitted at 2026-10-14 11:43:36 UTC, valid for 30 days.

The old registry, `0x773413C774d07f9aE949d930d8aA6643674315Ce`, remains on-chain.
Its reserve remains assigned to it; the replacement uses a distinct wallet rather
than attempting to reuse the old directory claim. Historical deployment records
remain available in Git history. The active record contains only the new KZG
registry's epochs and transaction receipts, alongside the unchanged records of the
other two methods. Old private KZG bundles were archived outside the repository.

Seven transactions completed for the replacement, with no pending transaction left.
The initial reserve-proof simulation returned `BadReserve` after the proposal
receipt; resuming the deployment completed the proof and approval without changing
contracts or creating another registry. The operations role-transfer drill was not
rerun for the replacement, and no completed KZG drill checkpoint is carried over.

Validation: 140 Solidity tests, all 20 Node test files and TypeScript checking passed.
The deployed runtime bytecode matches the compiled artifact after masking immutable
slots; company, auditor, token, reserve directory and epoch schedule were checked
separately on-chain. All three KZG customers verified through the website adapter,
and incorrect balances were rejected. The public-example exporter verified all
three methods and refreshed the KZG example and its downloadable proof.
The production website build, 13 browser tests and both GitHub Pages path tests
also passed.
