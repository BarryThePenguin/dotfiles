# OpenCode Go usage CLI

Fetch and display cached OpenCode Go quota usage.

```bash
pnpm --filter opencode-go-usage exec node src/cli.ts
pnpm --filter opencode-go-usage exec node src/cli.ts --json
pnpm --filter opencode-go-usage exec node src/cli.ts --strict
pnpm --filter opencode-go-usage exec node src/cli.ts --report
```

The CLI reads `OPENCODE_API_KEY`, uses the shared SQLite cache under
`$XDG_CACHE_HOME/opencode-go/usage.sqlite` (or `~/.cache/opencode-go/usage.sqlite`),
which also stores best-effort local routing events from `subagent-pi`. `--report`
prints an aggregate summary of those events. No prompts, responses, or API keys
are stored.
and refreshes it according to the client's cache TTL.

Options:

- `--json` emits machine-readable output.
- `--strict` exits non-zero for unavailable, stale, or warned results.
- `--endpoint=<url>` overrides the usage endpoint.

Missing credentials are reported as JSON or human-readable output and exit
non-zero. A stale cached result is displayed with a warning; use `--strict`
when stale data should fail automation.
