# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A personal dotfiles monorepo managed with [mise](https://mise.jdx.dev/). Configuration files live at the repo root and are symlinked into `$HOME` via `mise dotfiles` (declared in `.config/mise/config.toml` under `[dotfiles]`). Bootstrap is handled by `mise bootstrap`.

## Structure

```
.config/          → XDG config files (mise, git, atuin, ghostty, zellij, etc.)
.agents/          → Claude Code agent skills
.claude/          → Claude Code settings, plugins, MCP config
.config/zsh/      → Zsh config (ZDOTDIR=~/.config/zsh)
.zprezto-contrib/ → Custom prezto modules
.zshenv           → Sets ZDOTDIR and MISE_PROFILE; always sourced by zsh
stow/             → Legacy; now only holds .config/zellij/ (will be migrated)
scripts/          → Utility scripts for dev workflows
tools/            → Internal tooling packages (TypeScript monorepo)
bin/              → Bootstrap entry script
```

## Key Tools

- **mise** — runtime version manager and dotfile manager (`config.toml`)
- **pnpm** — package manager for the TypeScript monorepo in `tools/`
- **renovate** — automated dependency updates (`renovate.json`)

## Dotfiles management

Symlink targets are declared in `[dotfiles]` in `.config/mise/config.toml`. To apply dotfiles to `$HOME`:

```
mise bootstrap --only dotfiles
# or via task:
mise run dotfiles:install
```

Supported modes per entry: `symlink`, `symlink-each`, `copy`, `template`.

## Conventions

- Dotfiles live at the repo root following XDG structure (e.g. `.config/git/config`)
- Individual file entries in `[dotfiles]` override the mode of a parent `symlink-each` directory entry (used for `git/config` → template, `git/ignore` → copy)
- Scripts in `scripts/` should be executable and have a shebang
- TypeScript tooling lives in `tools/` as pnpm workspace packages
- Agent skills live in `.agents/skills/`

## Commands

- `mise bootstrap --yes` — full machine bootstrap (repos, dotfiles, tools, macos defaults)
- `mise bootstrap --dry-run` — preview what bootstrap would do
- `mise run dotfiles:install` — apply dotfiles only
- `mise run brew:bundle` — install Homebrew packages
- `pnpm install` — install TypeScript tooling dependencies
- `pnpm test` — run tests across all workspace packages
