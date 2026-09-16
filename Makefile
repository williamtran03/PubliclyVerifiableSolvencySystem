# Four arms live under arms/. Each is self-contained: contracts/, prover/,
# test/, script/, fixtures/. Shared code is shared/contracts/ReserveRegistry.sol
# (roles, signed reserves, epoch freshness), shared/merkleSumTree.ts and
# shared/customers.csv, the common input every arm is measured on.
#
#   arms/published-ledger  publish the whole ledger, contract recomputes the root
#   arms/zk-circuit        Noir/UltraHonk proof, per-asset solvency against public reserve floors
#   arms/snarkless         KZG polynomial commitments, no circuit
#   arms/single-asset      superseded by zk-circuit, kept for the gas comparison
#
# Target names are prefixed by arm: ledger-, zk-, kzg-, single-.

.PHONY: build test integration check compare \
        ledger-demo \
        zk-fixtures zk-check zk-prove zk-verifier zk-snapshot zk-circuit-test zk-demo demo-site \
        kzg-setup kzg-epoch \
        single-fixtures single-check single-proof single-prove single-verifier single-demo

# ---- all arms ------------------------------------------------------------
build:
	forge build

test:
	forge test
	node --import tsx --test shared/*.test.ts arms/*/prover/*.test.ts
	node --import tsx --test arms/*/test/*.test.ts

# spawns its own anvil on a free port; needs forge build output in out/
integration: build
	node --import tsx --test arms/*/test/*.test.ts

check:
	npx tsc --noEmit
	forge fmt --check

# regenerates every number in docs/comparison.md in one pass
compare:
	forge test --gas-report

# ---- arm: published-ledger ----------------------------------------------
# split + shuffle customers, publish the anonymised ledger, recompute on-chain
ledger-demo:
	npx tsx arms/published-ledger/script/demo.ts

# ---- arm: zk-circuit (multi-asset) --------------------------------------
# publicInputs = [floor0, floor1, floor2, context, rootHash]
zk-circuit-test:
	cd arms/zk-circuit/circuit && nargo test

# refresh snapshot.json (context, reserves, prices, rounds) from a deployed registry:
# make zk-snapshot REGISTRY=0x...
zk-snapshot:
	npx tsx arms/zk-circuit/prover/fetchSnapshot.ts $(REGISTRY)

# writes arms/zk-circuit/circuit/Prover.toml from customers.csv + snapshot.json
zk-fixtures:
	npx tsx arms/zk-circuit/prover/buildMultiAssetTree.ts

zk-check: zk-fixtures
	cd arms/zk-circuit/circuit && nargo execute

zk-prove: zk-check
	cd arms/zk-circuit/circuit && bb write_vk -s ultra_honk -b target/circuit_multiasset.json -o target/vk --oracle_hash keccak
	cd arms/zk-circuit/circuit && bb prove -s ultra_honk -b target/circuit_multiasset.json -w target/circuit_multiasset.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd arms/zk-circuit/circuit && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak
	npx tsx arms/zk-circuit/script/fixtures.ts

# regenerate the Solidity verifier -- only when the circuit changes
zk-verifier: zk-prove
	cd arms/zk-circuit/circuit && bb write_solidity_verifier -k target/vk/vk -o ../contracts/MultiAssetHonkVerifier.sol -t evm

# live demo; needs a local anvil first: anvil --silent &
# the script signs as anvil dev accounts 0 (company) and 1 (auditor)
zk-demo: build
	forge script arms/zk-circuit/script/Demo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# customer-facing demo site for this arm
demo-site: zk-fixtures
	npx vite --config vite.demo.config.ts

# ---- arm: snarkless (KZG) -----------------------------------------------
# one-time setup, the counterpart to the circuit's verification key
kzg-setup:
	npx tsx arms/snarkless/script/setup.ts

# per-epoch prover, the counterpart to zk-prove; same shared/customers.csv
kzg-epoch:
	npx tsx arms/snarkless/prover/buildEpoch.ts

# ---- arm: single-asset (superseded) -------------------------------------
# writes arms/single-asset/fixtures/epoch.json + circuit/Prover.toml
single-fixtures:
	npx tsx arms/single-asset/prover/buildTree.ts

single-check: single-fixtures
	cd arms/single-asset/circuit && nargo execute

# proves into circuit/target/proof; leaves the committed fixture alone
single-proof: single-check
	cd arms/single-asset/circuit && bb write_vk -s ultra_honk -b target/circuit.json -o target/vk --oracle_hash keccak
	cd arms/single-asset/circuit && bb prove -s ultra_honk -b target/circuit.json -w target/circuit.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd arms/single-asset/circuit && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak

# refreshes the committed fixture from a new proof
single-prove: single-proof
	cp arms/single-asset/circuit/target/proof/proof arms/single-asset/fixtures/proof.bin

single-verifier: single-prove
	cd arms/single-asset/circuit && bb write_solidity_verifier -k target/vk/vk -o ../contracts/HonkVerifier.sol -t evm

single-demo: build
	@npx tsx arms/single-asset/script/demo.ts
