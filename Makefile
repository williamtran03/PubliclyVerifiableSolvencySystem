.PHONY: build test demo

build:
	forge build

test:
	forge test

demo: build
	@npx tsx script/demo.ts
