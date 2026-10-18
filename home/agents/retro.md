# Reading a past session (retro)

    mise retro:dump-session                        # newest session
    mise retro:dump-session ses_xxx                # a specific session
    SESSION_ID=ses_xxx mise retro:dump-session     # same, via the env var

Dumps the session's user messages and tool calls, with tool output sizes
and exit codes. OpenCode's HTTP API is the supported source, not
`opencode.db`: the docs warn against reading that database with external
tools, and its legacy `session`/`message` tables are months stale. The raw
equivalent is `opencode api get /api/session/{id}/message`.

The session id is a positional argument (env-backed by `SESSION_ID`), so
the MCP `run_task` tool can pass it as an argument.
