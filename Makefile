.PHONY: deps lint format typecheck test prepare-for-commit dev package-mac package-linux

deps:
	bun install

lint:
	bunx oxlint .

format:
	bunx oxfmt --write .

typecheck:
	bun run typecheck

test:
	bun test

prepare-for-commit: format lint typecheck test

dev:
	bun run dev

package-mac: deps
	bun run build:mac
	codesign --force --deep --sign - dist/mac-arm64/GitPinger.app

package-linux: deps
	bun run build:linux
