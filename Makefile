.PHONY: build test test-sol test-ts prove demo clean

build:
	forge build

test: test-sol test-ts

test-sol: build
	forge test

test-ts:
	npx tsx --test prover/*.test.ts

# Rebuilds fixtures/epoch.json and the per-customer proofs from customers.csv.
prove:
	npx tsx prover/buildTree.ts

# anvil -> deploy -> attest reserves -> publish root -> customer check -> insolvency rejected
demo: build
	npx tsx script/demo.ts

clean:
	forge clean
	rm -rf fixtures/proof-*.json
