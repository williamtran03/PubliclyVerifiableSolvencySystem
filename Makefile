.PHONY: build test demo

build:
	npm run build

test:
	npm run typecheck
	npm test

demo:
	npm run demo
