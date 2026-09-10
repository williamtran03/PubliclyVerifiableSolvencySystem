.PHONY: build test demo demo-site fixtures circuit-check circuit-prove circuit-verifier kzg-setup kzg-epoch frontend multiasset-test multiasset-prices multiasset-fixtures multiasset-check multiasset-prove multiasset-demo multiasset-verifier

build:
	forge build

test:
	forge test
	node --import tsx --test prover/*.test.ts prover/kzg/*.test.ts prover/keccak/*.test.ts prover/multi-asset/*.test.ts prover/split/*.test.ts

demo: build
	@npx tsx script/demo.ts

frontend: fixtures
	npx vite

# customer-facing demo site for the multi-asset arm
demo-site: multiasset-fixtures
	npx vite --config vite.demo.config.ts

# writes fixtures/epoch.json + circuits/single-asset/Prover.toml from customers.csv
fixtures:
	npx tsx prover/buildTree.ts

circuit-check: fixtures
	cd circuits/single-asset && nargo execute

circuit-prove: circuit-check
	cd circuits/single-asset && bb write_vk -s ultra_honk -b target/circuit.json -o target/vk --oracle_hash keccak
	cd circuits/single-asset && bb prove -s ultra_honk -b target/circuit.json -w target/circuit.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd circuits/single-asset && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak
	cp circuits/single-asset/target/proof/proof fixtures/proof.bin

# regenerate contracts/HonkVerifier.sol -- only needed when the circuit changes
circuit-verifier: circuit-prove
	cd circuits/single-asset && bb write_solidity_verifier -k target/vk/vk -o ../../contracts/HonkVerifier.sol -t evm

# ---- arm 2: KZG grand sum (no circuit) ------------------------------------
# one-time setup, the counterpart to the circuit's verification key
kzg-setup:
	npx tsx script/kzg-setup.ts

# per-epoch prover, the counterpart to circuit-prove; same customers.csv
kzg-epoch:
	npx tsx prover/kzg/buildEpoch.ts

# ---- arm 3: multi-asset circuit, prices as public inputs -------------------
# publicInputs = [price0, price1, price2, rootHash, totalLiabilitiesUsd]
multiasset-test:
	cd circuits/multi-asset && nargo test

# refresh prover/multi-asset/prices.json from a deployed registry: make multiasset-prices REGISTRY=0x...
multiasset-prices:
	npx tsx prover/multi-asset/fetchPrices.ts $(REGISTRY)

# writes circuits/multi-asset/Prover.toml from customers-multiasset.csv + prices.json
multiasset-fixtures:
	npx tsx prover/multi-asset/buildMultiAssetTree.ts

multiasset-check: multiasset-fixtures
	cd circuits/multi-asset && nargo execute

multiasset-prove: multiasset-check
	cd circuits/multi-asset && bb write_vk -s ultra_honk -b target/circuit_multiasset.json -o target/vk --oracle_hash keccak
	cd circuits/multi-asset && bb prove -s ultra_honk -b target/circuit_multiasset.json -w target/circuit_multiasset.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd circuits/multi-asset && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak
	npx tsx script/multiasset-fixtures.ts

# live demo; needs a local anvil first: anvil --silent &
# key is the standard anvil dev account, same one script/demo.ts uses
multiasset-demo: build
	forge script script/MultiAssetDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
		--private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# regenerate contracts/MultiAssetHonkVerifier.sol -- only when the circuit changes
multiasset-verifier: multiasset-prove
	cd circuits/multi-asset && bb write_solidity_verifier -k target/vk/vk -o ../contracts/MultiAssetHonkVerifier.sol -t evm
