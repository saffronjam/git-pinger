# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**git-pinger** is an Electron desktop app (macOS + Linux) that monitors GitHub and GitLab for PR/MR activity and sends native OS notifications. Built with electron-vite, React, TypeScript, and shadcn/ui.

## Tech Stack

- **Package manager**: Bun (used for install/scripts; Electron's main process still runs on Node.js internally)
- **Build tool**: `electron-vite` (electron-vite.org by alex8088) — unified config for main/preload/renderer
- **Runtime**: Electron (latest stable)
- **Renderer**: React + TypeScript
- **UI**: shadcn/ui (Radix UI primitives + Tailwind CSS v4 via `@tailwindcss/vite`)
- **Linter**: oxlint
- **Formatter**: oxfmt
- **Config storage**: `electron-conf` (typed, fast, CJS+ESM compatible)
- **Secret storage**: Electron `safeStorage` for tokens (OS keychain on macOS, Secret Service on Linux)

## Commands

```bash
bun run dev              # Start electron-vite dev server with hot reload
bun run build            # Typecheck + build all three targets (main/preload/renderer)
bun run typecheck        # Run both node + web typechecks
bun run typecheck:node   # Check main + preload (tsconfig.node.json)
bun run typecheck:web    # Check renderer (tsconfig.web.json)
bun run test             # Run bun:test across src (main-process unit tests)
bun run test:watch       # Re-run tests on file changes
bun run lint             # oxlint
bun run lint:fix         # oxlint --fix
bun run format           # oxfmt --write
bun run format:check     # oxfmt --check (CI mode)
bun run build:mac        # Build for macOS
bun run build:linux      # Build for Linux
make prepare-for-commit  # Run format + lint + typecheck + test (use before committing)
```

## Code Style Rules

- **No `any` types**: Enforced by both TypeScript (`noImplicitAny: true`) and oxlint (`@typescript-eslint/no-explicit-any: error`). Use `unknown` + type narrowing or generics instead.
- **No unnecessary comments**: No inline comments restating what code does. No section dividers like `// ===== section =====`. Code should be self-documenting.
- **JSDoc required**: All exported functions and non-trivial components must have JSDoc with `@param` and `@returns`.
- **Reuse components**: Always search `src/renderer/src/components/` before creating new components.
- **Formatting**: oxfmt handles all formatting — single quotes, no semicolons, trailing commas.

## Architecture

### Process Model

```
src/
├── shared/      # Type-only definitions shared by main + renderer (no runtime code — types, interfaces, consts only)
├── main/        # Main process (Node.js) — app lifecycle, API polling, notifications, token/config storage, IPC handlers
├── preload/     # IPC bridge — contextBridge exposes typed `window.api` for renderer
└── renderer/    # React UI
    └── src/
        ├── assets/      # Tailwind v4 CSS + theme variables + drag-region styles
        ├── components/
        │   ├── ui/          # shadcn primitives
        │   ├── icons/       # Provider + app SVG icons
        │   ├── layout/      # App shell and header (drag region)
        │   ├── onboarding/  # Auth forms (OAuth + PAT)
        │   ├── main/        # Project monitoring, event config, provider status
        │   └── settings/    # Connections, polling, lookback, theme, notification templates
        ├── hooks/       # React hooks for config, poller status, repo sync, theme
        └── lib/         # Utilities
```

### Path Alias

`@/*` resolves to `src/renderer/src/*` in both tsconfig and Vite. Used for all renderer imports.

### Dark/Light Mode

Theme is managed by a `ThemeProvider` hook that applies a `.dark` class on `<html>`. CSS variables in `src/renderer/src/assets/` define both light and dark palettes. The `@custom-variant dark` directive in Tailwind v4 enables `dark:` utilities.

### Data Flow

1. **Main process** polls GitHub/GitLab APIs on a configurable interval
2. State changes (new PRs, review requests, etc.) trigger `Notification` from main process
3. Renderer communicates with main via typed IPC (preload bridge) for settings UI
4. Tokens stored via `safeStorage`, preferences via `electron-conf`

### API Integration

**GitHub** — OAuth Device Flow (scopes: `repo`, `notifications`, `read:user`). Requires `MAIN_VITE_GITHUB_CLIENT_ID` env var:

- `GET /user` — validate token
- `GET /user/repos` — list accessible repos
- `GET /notifications?since=&participating=true` — PR notifications (filtered by reason)

**GitLab** — OAuth Device Flow for gitlab.com (`MAIN_VITE_GITLAB_CLIENT_ID`), PAT for self-hosted (`read_api` scope):

- `GET /api/v4/user` — validate token
- `GET /api/v4/projects?membership=true` — list projects
- `GET /api/v4/merge_requests?scope=assigned_to_me` — assigned MRs
- `GET /api/v4/merge_requests?scope=reviews_for_me` — review-requested MRs

### MVP Notification Events (per-project toggle)

- **PR/MR updates** — state changes on PRs/MRs in selected projects
- **PR/MR assigned** — user is assigned to a PR/MR
- **PR/MR review requested** — user is asked to review

### Key Patterns

- **Notification GC bug (macOS)**: Always hold a reference to `Notification` objects until click/close fires, or event handlers get garbage-collected after ~1-2 minutes
- **Notification icon (macOS)**: The small sender avatar in macOS banners is _always_ the delivering bundle's `CFBundleIconFile` — `UNUserNotificationCenter` has no per-notification override. Electron's `icon` option becomes an attachment (right-side thumbnail) on macOS, not the avatar. Dev mode runs from `node_modules/electron/dist/Electron.app` (bundle id `com.github.Electron`), so banners show the Electron atom; the packaged app uses our `appId`/`icon.icns` and shows the correct icon. No code fix — run the packaged build to verify. See electron/electron#1025.
- **Adding shadcn components**: `bunx shadcn@latest add <component>` — components land in `src/renderer/src/components/ui/`
- **IPC typing**: All IPC channels and types are defined in `src/shared/`. Preload exposes `window.api` with typed methods.
- **Environment variables**: `MAIN_VITE_GITHUB_CLIENT_ID` and `MAIN_VITE_GITLAB_CLIENT_ID` for OAuth. Use `MAIN_VITE_` prefix for main process, `RENDERER_VITE_` for renderer.
- **Shared types**: `src/shared/` contains type-only definitions importable by both tsconfigs. No runtime code — only types, interfaces, and const values.
- **HTTP calls go through the shared `http-client`**: never call `fetch` directly from provider code. The client classifies failures as typed `ApiError` (`unauthorized`, `forbidden`, `not_found`, `rate_limited`, `server`, `network`, `other`) and logs every request/response with structured context. Pagination loops throw on non-OK responses — no silent breaks.
- **Token refresh**: GitLab OAuth tokens carry `refreshToken` / `expiresAt`. The `AuthRefresher` is wired as `onUnauthorized` on GitLab HTTP calls — on 401 it refreshes transparently, and only flips `connection.needsReauth` if refresh fails (or isn't available for PAT auth).
- **Structured logging**: `logger.info(message, context?)` where context is an object of key/value pairs. Context is rendered into log lines and retained in the in-memory buffer surfaced in the UI log viewer.
- **Service lifecycle**: After any config change (auth, disconnect, monitored project add/remove), call `syncServicesToConfig(configManager, poller, repoSyncer)` from `service-manager.ts` instead of manual start/stop.
- **macOS hybrid tray (menu bar) app**: On darwin only, `TrayManager` (`src/main/tray-manager.ts`) creates a status-bar icon with a context menu. The window's red traffic-light is intercepted to `hide()` instead of close (gated by an `isQuitting` flag set on `before-quit`); `cmd+Q` and the tray's "Quit" item perform a real quit. Linux keeps the original behavior. The tray menu rebuilds from a pure `resolveTrayState` + `buildTrayMenuTemplate` pipeline — no Electron in the helpers, easy to unit-test.
- **Tray icon must be a template image (macOS)**: Filename ends in `Template` (e.g. `tray-iconTemplate.png`) and the asset is monochrome with alpha. Electron's `nativeImage.setTemplateImage(true)` makes macOS auto-tint it for light/dark menu bars. Author from `resources/tray-iconTemplate.svg` and render with `qlmanage -t -s <px> -o <dir>`.
- **Open at login (macOS)**: `app.setLoginItemSettings({ openAtLogin, openAsHidden: true })` is applied from `config.startup.runAtLogin` on boot and from the `config:set-run-at-login` IPC handler. On a login-launched start, `app.getLoginItemSettings().wasOpenedAtLogin && wasOpenedAsHidden` short-circuits `bootMainWindow()` so the app comes up tray-only.
- **Tests**: `bun test` runs `*.test.ts` files co-located with sources. `src/main/test-helpers.ts` installs a routable `globalThis.fetch` stub — always call `installFetchMock` / `resetFetchMock` in `beforeEach` / `afterEach`. Main-process classes that need Electron APIs (token store, notifications) take those as constructor injections so tests don't load the `electron` module.

### UX Flow

- **No connections**: Onboarding screen with GitHub/GitLab authentication forms
- **At least one connected**: Main view showing monitored projects + notification settings; the other provider shows as a settings item to optionally connect

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push to main and PRs:

- **lint**: `bun run lint` (oxlint)
- **format**: `bun run format:check` (oxfmt)
- **typecheck**: `bun run typecheck` (tsc for both node + web targets)
- **test**: `bun run test` (bun:test unit suite)
