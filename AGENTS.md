# AGENTS.md

Personal dotfiles for macOS, managed by [mise](https://mise.jdx.dev/). Files in this repo are symlinked into `$HOME`; editing a tracked file here edits the live config.

## Layout

```
.config/          XDG config, mirrors ~/.config (mise, git, zsh, opencode, ssh, …)
.agents/skills/   agent skills; linked into ~/.claude, ~/.config/opencode and ~/.pi
.zprezto-contrib/ custom prezto modules
home/             `home` profile files: ~/AGENTS.md and ~/.config/agents
work/             `work` profile files: ~/CLAUDE.md
scripts/          executable helpers, each with a shebang
docs/agents/      per-skill config (issue tracker, triage labels, domain docs)
.zshenv           sets ZDOTDIR; always sourced
mise.toml         tooling for working on this repo (hk, pnpm)
```

Related repo: `~/src/btp/agent-tools` holds the TypeScript tooling (issue-tools, doist, subagent-pi). Dotfile entries link into it, so changes there go in that repo.

## Mise config

- `.config/mise/config.toml` is the global config, linked to `~/.config/mise`. It declares tools, brew/mas packages and every `[dotfiles]` entry. The repo-root `mise.toml` is a separate, project-only config.
- Profiles: `env` in `~/.config/mise/miserc.local.toml` (untracked, per machine; `home`, `work` or `devcontainer`) loads `.config/mise/mise.<profile>.toml`, which selects `dotfile_groups` and adds per-profile packages, launchd agents and tools. The tracked `miserc.toml` defaults to `home`; `mise -E <profile>` overrides it for one run.
- `.config/mise/locks/` is generated; regenerate it with mise instead of editing.
- Tasks live in `.config/mise/tasks/`; `mise tasks ls` lists them. Run `net:check` first when a tool fails after laptop sleep.

## Dotfiles

Declare a new link under `[dotfiles]`, then `mise run dotfiles:install`. Preview with `mise bootstrap --dry-run`.

- Prefer `symlink-each` with `manifest = "git"` for a directory an app also writes into (`1Password`, `gh`, `mise`, `zellij`, `zsh`). A plain `symlink` makes the app write its state into this repo.
- To vary a file per profile, link each profile's variant to one fixed path from its `[dotfile_groups.<profile>.entries]` (zellij's `layouts/default.kdl` links `home.kdl` or `work.kdl`), so consumers need no profile lookup.
- `git add` a new file in a `symlink-each` directory before installing; only tracked files link.
- A single-file entry overrides its parent directory's mode (`gh/hosts.yml` is `track` inside `gh`'s `symlink-each`).

## Verify

`pnpm check` runs typecheck, lint and tests; `hk` runs the same linters plus the `net:check` regression test.

## Agent skills

- Issues and specs live in Todoist, project Dotfiles (id `6h9Wxp68J6HrG99m`). Before touching issues, read `docs/agents/issue-tracker.md`.
- Before applying or creating triage labels, read `docs/agents/triage-labels.md`.
- Before exploring the domain, read `docs/agents/domain.md`; it points to `GLOSSARY.md` and `docs/adr/`.
