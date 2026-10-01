<p align="center">
  <img src="resources/icon.svg" alt="GitPinger" height="128">
</p>

<h1 align="center">GitPinger</h1>

<p align="center">
  GitHub & GitLab notifications on your desktop. Available on macOS and Linux.
</p>

<p align="center">
  <a href="https://github.com/saffronjam/git-pinger/actions/workflows/ci.yml"><img src="https://github.com/saffronjam/git-pinger/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/saffronjam/git-pinger/releases"><img src="https://img.shields.io/github/v/release/saffronjam/git-pinger" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/saffronjam/git-pinger" alt="License"></a>
</p>

<p align="center">
  <img src="resources/app.png" alt="GitPinger screenshot" width="600">
</p>

## Features

- **GitHub + GitLab** — monitor PRs and MRs across both platforms in one app
- **Native notifications** — get pinged when you're assigned, review-requested, or a PR updates
- **Fewer self-notifications** — your own assignments, comments, and PR creation stay silent when identified. Completed reviews (including GitLab adding you as a reviewer after approval) stay silent too; a later review request can notify again. Unknown assignment actors still notify.
- **Per-project control** — choose exactly which repos and events you care about
- **OAuth & PAT auth** — Device Flow for github.com and gitlab.com, Personal Access Tokens for self-hosted GitLab
- **Lightweight** — lives in your system tray, polls on a configurable interval

## Download

Grab the latest release for your platform:

| Platform | Download                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | [`.dmg`](https://github.com/saffronjam/git-pinger/releases/latest)                                                                           |
| Linux    | [`.AppImage`](https://github.com/saffronjam/git-pinger/releases/latest) / [`.deb`](https://github.com/saffronjam/git-pinger/releases/latest) |

## Development

Install Bun and just (`brew install oven-sh/bun/bun just` on macOS), then run:

```bash
just deps
just dev
```

Run `just` to list all recipes, or `just prepare-for-commit` to format, lint, typecheck, and test.

See [`CLAUDE.md`](CLAUDE.md) for architecture details and the full command reference.

## License

[MIT](LICENSE)
