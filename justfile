# Git Pinger task runner. Run `just` to list every recipe.

set shell := ["bash", "-euo", "pipefail", "-c"]

[private]
default:
    @just --list --unsorted

[doc('Install dependencies')]
[group('setup')]
deps:
    bun install

[doc('Start the Electron app with hot reload')]
[group('dev')]
dev:
    bun run dev

[doc('Run oxlint')]
[group('check')]
lint:
    bun run lint

[doc('Apply automatic lint fixes')]
[group('check')]
lint-fix:
    bun run lint:fix

[doc('Format source with oxfmt')]
[group('check')]
format:
    bun run format

[doc('Check formatting without changing files')]
[group('check')]
format-check:
    bun run format:check

[doc('Typecheck main, preload, and renderer')]
[group('check')]
typecheck:
    bun run typecheck

[doc('Typecheck main and preload')]
[group('check')]
typecheck-node:
    bun run typecheck:node

[doc('Typecheck the renderer')]
[group('check')]
typecheck-web:
    bun run typecheck:web

[doc('Run unit tests')]
[group('check')]
test:
    bun run test

[doc('Re-run unit tests on file changes')]
[group('check')]
test-watch:
    bun run test:watch

[doc('Format, lint, typecheck, and test before committing')]
[group('check')]
prepare-for-commit: format lint typecheck test

[doc('Typecheck and build main, preload, and renderer')]
[group('build')]
build:
    bun run build

[doc('Install dependencies, package for macOS, and ad-hoc sign the ARM64 app')]
[group('build')]
package-mac: deps
    bun run build:mac
    codesign --force --deep --sign - dist/mac-arm64/GitPinger.app

[doc('Install dependencies and package for Linux')]
[group('build')]
package-linux: deps
    bun run build:linux

[doc('Regenerate tray icons from SVG (requires librsvg)')]
[group('codegen')]
icons:
    @command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert not found. Install with: brew install librsvg" >&2; exit 1; }
    rsvg-convert -w 16 -h 16 -o resources/tray-iconTemplate.png resources/tray-iconTemplate.svg
    rsvg-convert -w 32 -h 32 -o resources/tray-iconTemplate@2x.png resources/tray-iconTemplate.svg
    @echo "Tray icons regenerated from resources/tray-iconTemplate.svg"
