.PHONY: build test check frontend backend

build:
	forge build
	npm run abi
	npx vite build

test:
	forge build
	forge test
	npm test

check:
	npx tsc --noEmit
	forge fmt --check

frontend:
	npm run dev

# Set MINIMUM_PRIVATE_DIR to a private directory outside the repository.
backend:
	npm run backend
