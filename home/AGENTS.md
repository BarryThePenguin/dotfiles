# AGENTS.md

## Tool CLI Routing

Determine the forge from the origin remote of the current repo, then route all
issue/PR/MR references and URLs through the matching tool:

- GitHub (github.com) → `gh`
- GitLab (gitlab.com or self-hosted) → `glab`
- Forgejo (*.jonno.dev) → `fj`

A bare `#123` refers to the current repo's forge.

## Shell

The login shell is zsh, which does not word-split unquoted variables. Put
multi-step logic in a script with a `#!/usr/bin/env bash` shebang and run that, or
loop over an array.

## References

- [Connectivity failures (DNS / laptop sleep)](~/.config/agents/connectivity.md)
- [Reading a past session (retro)](~/.config/agents/retro.md)
- [Checking CI (Woodpecker)](~/.config/agents/ci.md)
- [Research standards](~/.config/agents/research.md)
