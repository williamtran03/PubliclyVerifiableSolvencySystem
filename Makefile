.PHONY: build test test-sol test-ts test-circuit prove demo clean

build:
	forge build

test: test-sol test-ts test-circuit

test-sol: build
	forge test

test-ts:
	npx tsx --test prover/*.test.ts

test-circuit:
	cd circuits/solvency && nargo test

# Rebuilds the tree, the witness, the proof, and the Solidity verifier.
# Needs nargo + bb; see docs/zk.md.
prove:
	npx tsx prover/buildTree.ts
	npx tsx script/prove.ts

# anvil -> deploy verifier + registry -> attest reserves -> publish with proof
# -> customer check -> understated total rejected -> insolvency rejected
demo: build
	npx tsx script/demo.ts

clean:
	forge clean
	rm -rf fixtures/proof-*.json circuits/solvency/target
