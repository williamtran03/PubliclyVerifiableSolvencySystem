.PHONY: build test test-sol test-ts setup commit demo clean

build:
	forge build

test: test-sol test-ts

test-sol: build
	forge test

test-ts:
	npx tsx --test prover/*.test.ts prover/kzg/*.test.ts

# One-off: generates the development SRS. Read the warning in script/setup.ts.
setup:
	npx tsx script/setup.ts 16

# Rebuilds the commitments, the grand sum opening, the range argument, and one
# opening per customer.
commit:
	npx tsx prover/buildTree.ts
	npx tsx script/commit.ts

# anvil -> deploy -> attest reserves -> publish with a grand sum opening
# -> on-chain inclusion check -> range check -> the refusals
demo: build
	npx tsx script/demo.ts

clean:
	forge clean
	rm -rf fixtures/proof-*.json fixtures/kzg-proof-*.json
