.PHONY: deps lint format typecheck test prepare-for-commit dev package-mac package-linux icons

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

icons:
	@command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert not found. Install with: brew install librsvg" >&2; exit 1; }
	rsvg-convert -w 16 -h 16 -o resources/tray-iconTemplate.png resources/tray-iconTemplate.svg
	rsvg-convert -w 32 -h 32 -o resources/tray-iconTemplate@2x.png resources/tray-iconTemplate.svg
	@echo "Tray icons regenerated from resources/tray-iconTemplate.svg"
