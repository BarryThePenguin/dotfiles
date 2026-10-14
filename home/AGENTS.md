# AGENTS.md

Loaded for every workspace under this home directory, ahead of that repo's
own guidance. Keep it to pointers: repo guidance belongs in the repo's
`AGENTS.md`. Unlike a global file, this one does not reach a workspace
outside the home directory.

The mise tasks named here are defined once, in the task files under
`~/src/btp/dotfiles/.config/mise/tasks/` (`dotfiles.toml`, `net.toml`,
`retro.toml`). Each is symlinked into `~/.config/mise/tasks/` like every other
managed dotfile, so they run in every project as bare `mise <task>` — no
`--dir`, no repo of origin to remember.

## Tool Routing

- GitHub URLs, issue numbers, or PR numbers → use `gh`
- GitLab URLs, MR numbers, or issue numbers → use `glab`

## Anything failing to connect, resolve a host, or authenticate

The laptop sleeps unattended and macOS then loses its DNS configuration:
every Go binary (`gh`) and every name-based client (`curl`, `git`) fails
while `dig` still works, because `dig` falls back to the router. The
symptom reads as "the service is down", and it usually is not.

Run the probe first, investigate second:

    mise net:check

It prints `LAPTOP SLEPT`, `OFF-NETWORK`, or `cluster-side` (laptop healthy,
the cluster is at fault). `mise net:fix` repairs it, handing you the two
`sudo` lines when a password is needed.

## Reading a past session (retro)

    mise retro:dump-session                        # newest session
    mise retro:dump-session ses_xxx                # a specific session
    SESSION_ID=ses_xxx mise retro:dump-session     # same, via the env var

That dumps the session's user messages and tool calls, with tool output
sizes and exit codes. OpenCode's HTTP API is the supported source, not
`opencode.db`: the docs warn against reading that database with external
tools, and its legacy `session`/`message` tables are months stale. The raw
equivalent is `opencode api get /api/session/{id}/message`.

The session id is a positional argument (env-backed by `SESSION_ID`), so the
MCP `run_task` tool can pass it as an argument.

## Checking CI (Woodpecker)

Do not hand-roll a poll loop around `woodpecker-cli`. The `ci` command (the
ci-cli package in the agent-tools repo, installed globally) does the wait, the
parsing, the ANSI strip and the failing-step log fetch in one call, and
answers with an exit code:

    ci status          # what CI is doing for this branch, failing step named
    ci wait            # block until HEAD's pipeline ends: 0 pass, 1 fail, 3 running
    ci logs            # the failing steps' logs, ANSI stripped

`ci wait` selects the pipeline for HEAD's exact commit, so after a push it
answers "did my push pass?". `CI_PIPELINE=<n>`, `CI_REPO`, `CI_BRANCH`,
`CI_TIMEOUT` and `CI_POLL` override; `ci <command> --help` documents the rest.

## Finding the project's other tasks

The `mise` MCP server is registered globally, so every session has
`list_commands` (each mise command tagged `read`, `write` or `destructive`),
`run_task`, and the `mise://tasks` resource for the current project. Call
`list_commands` before running an unfamiliar command, and prefer `run_task`
over a shell invocation: it runs the task's own environment, so it is not
subject to the PATH and shim problems of a plain shell.
