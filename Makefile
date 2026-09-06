.PHONY: build test demo

build:
	forge build

test:
	forge test

# grows into the full pipeline: anvil -> deploy -> build tree -> prove -> submit epoch -> assert solvent
demo: build test
