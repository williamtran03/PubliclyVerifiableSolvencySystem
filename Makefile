.PHONY: build test demo circuit-check circuit-prove

build:
	forge build

test:
	forge test

demo: build
	@npx tsx script/demo.ts

circuit-check:
	cd circuit && nargo execute

circuit-prove: circuit-check
	cd circuit && bb write_vk -s ultra_honk -b target/circuit.json -o target/vk --oracle_hash keccak
	cd circuit && bb prove -s ultra_honk -b target/circuit.json -w target/circuit.gz -o target/proof -k target/vk/vk --oracle_hash keccak
	cd circuit && bb verify -s ultra_honk -p target/proof/proof -k target/vk/vk -i target/proof/public_inputs --oracle_hash keccak
