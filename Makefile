.PHONY: lint format typecheck prepare-for-commit dev package-mac package-linux

lint:
	bunx oxlint .

format:
	bunx oxfmt --write .

typecheck:
	bun run typecheck

prepare-for-commit: format lint typecheck

dev:
	bun run dev

package-mac:
	bun run build:mac
	codesign --force --deep --sign - dist/mac-arm64/GitPinger.app

package-linux:
	bun run build:linux
