# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A personal dotfiles monorepo managed with [GNU Stow](https://www.gnu.org/software/stow/). Configuration files live under `stow/` and are symlinked into `$HOME` via `stow stow/`.

## Structure

```
stow/             → Dotfiles symlinked into $HOME via GNU Stow
  .config/        → XDG config files (mise, git, fnox, yazi, zellij, etc.)
  .agents/        → Claude Code agent skills and configuration
  .claude/        → Claude Code settings, plugins, MCP config
  .pi/            → Pi coding agent config
scripts/          → Utility scripts for dev workflows
tools/            → Internal tooling packages (TypeScript monorepo)
```

## Key Tools

- **mise** — runtime version manager (`stow/.config/mise/config.toml`)
- **GNU Stow** — symlink farm manager; run `stow stow/` from repo root to apply dotfiles
- **pnpm** — package manager for the TypeScript monorepo in `tools/`
- **renovate** — automated dependency updates (`renovate.json`)

## Conventions

- Dotfiles go under `stow/` following the XDG directory structure
- Scripts in `scripts/` should be executable and have a shebang
- TypeScript tooling lives in `tools/` as pnpm workspace packages
- Agent skills live in `stow/.agents/skills/`

## Commands

- `stow stow/` — apply all dotfiles to $HOME
- `pnpm install` — install TypeScript tooling dependencies
- `pnpm test` — run tests across all workspace packages
