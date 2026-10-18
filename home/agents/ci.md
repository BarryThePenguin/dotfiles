# Checking CI (Woodpecker)

Use the `ci` command (ci-cli, installed globally) instead of polling
`woodpecker-cli` directly — it waits, parses, strips ANSI, and fetches the
failing step's logs in one call, returning an exit code:

    ci status          # what CI is doing for this branch, failing step named
    ci wait            # block until HEAD's pipeline ends: 0 pass, 1 fail, 3 running
    ci logs            # the failing steps' logs, ANSI stripped

`ci wait` selects the pipeline for HEAD's exact commit, so after a push it
answers "did my push pass?". `CI_PIPELINE=<n>`, `CI_REPO`, `CI_BRANCH`,
`CI_TIMEOUT` and `CI_POLL` override; `ci <command> --help` documents the rest.
