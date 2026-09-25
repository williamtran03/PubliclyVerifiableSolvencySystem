# Public Sepolia release — 25 September 2026

All three registries are deployed with 30-day validity and a 60-second minimum
epoch interval. The operations drill completed for every approach, restoring the
original Company/Auditor roles and approving the reserves again.

| Approach | Registry | Latest epoch transaction | Valid until (UTC) |
| --- | --- | --- | --- |
| published-ledger | [0x7e176FABa50B4928DEB90533e0c6eBB546F944f9](https://sepolia.etherscan.io/address/0x7e176FABa50B4928DEB90533e0c6eBB546F944f9) | [Epoch 1](https://sepolia.etherscan.io/tx/0x8bac951d59681ce2b5464b1d30bb0fd4007610758700332839236f61d09e86eb) | 2026-10-25T12:36:00+00:00 |
| zk-circuit | [0xbdECC34e173009cc44FDFf12886cCF7c9038452B](https://sepolia.etherscan.io/address/0xbdECC34e173009cc44FDFf12886cCF7c9038452B) | [Epoch 1](https://sepolia.etherscan.io/tx/0x5efd64a1c1213eefe6f1e12dd501770e96d9cf691f599034d22477d7ef0302aa) | 2026-10-25T12:36:36+00:00 |
| snarkless | [0x773413C774d07f9aE949d930d8aA6643674315Ce](https://sepolia.etherscan.io/address/0x773413C774d07f9aE949d930d8aA6643674315Ce) | [Epoch 1](https://sepolia.etherscan.io/tx/0x1a4fdb9cc08b8961c1b1cd60686c938d921a70ec36c50f4f5fe7057c3df9fa09) | 2026-10-25T12:37:24+00:00 |

The deployment record contains 79 confirmed transactions and no pending transaction.
Epochs 0 and 1 passed customer verification through the website adapters, including
rejection of deliberately incorrect balances. Three fictional examples were exported
and verified against epoch 1; private bundles remain outside the repository.

Local validation passed: 110 Solidity tests, 19 Node test files, fresh ZK-proof
integration, both demo/recovery tests, 13 browser tests and the Pages subpath test.
Node 26.10.0 / Foundry 1.8.1 were used locally; CI uses Node 22 / Foundry 1.7.1.

Two operations checkpoints needed a resume after transient RPC simulation/state
disagreements. No checkpoints were edited and no contracts changed for recovery.

The repository is public and Pages is configured. GitHub CI, promotion to main,
and live hosted verification remain pending.
