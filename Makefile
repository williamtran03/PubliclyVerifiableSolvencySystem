.PHONY: build test demo fixtures circuit-check circuit-prove circuit-verifier kzg-setup kzg-epoch frontend

build:
	forge build

test:
	forge test

demo: build
	@npx tsx script/demo.ts

frontend: fixtures
	npx vite

# writes fixtures/epoch.json + circuit/Prover.toml from customers.csv
fixtures:
	npx tsx prover/buildTree.ts

circuit-check: fixtures
	cd circuit && nargo execute

circuit-prove: circuit-check
	cd circuit && bb write_vk -s ultra_honk -b target/circuit.json -o target/vk --oracle_hash keccak
	cd circuit && bb prove -s ultra_honk -b target/circuit.json -w target/circuit.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd circuit && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak
	cp circuit/target/proof/proof fixtures/proof.bin

# regenerate contracts/HonkVerifier.sol -- only needed when the circuit changes
circuit-verifier: circuit-prove
	cd circuit && bb write_solidity_verifier -k target/vk/vk -o ../contracts/HonkVerifier.sol -t evm

# ---- arm 2: KZG grand sum (no circuit) ------------------------------------
# one-time setup, the counterpart to the circuit's verification key
kzg-setup:
	npx tsx script/kzg-setup.ts

# per-epoch prover, the counterpart to circuit-prove; same customers.csv
kzg-epoch:
	npx tsx prover/kzg/buildEpoch.ts
