# ADR 0003: Central Shared Database

**Status**: Accepted

**Date**: 2026-08-22

## Context

Each git repo keeps its own `todoist.db` next to its `.doistrc`. Every consumer (CLI, MCP, agents) that runs inside a repo opens its own private copy of Todoist, with its own sync-token chain:

- N repos means N redundant mirrors of the same account, each burning its own API quota on overlapping incremental syncs.
- Concurrent consumers of the _same_ repo race their incremental fetches against one token chain — a delta fetched by one process can be overwritten or duplicated by another.

Two prerequisites made centralization safe:

1. **Persist everything, filter at read time** (ADR-adjacent contract, landed in `4ab3fbb`): the store is a full account mirror and repo scoping is purely a read-time project lens, so a store shared across repos no longer bakes any single repo's allowlist into its contents.
2. **Sync-token/data atomicity** (ADR 0001): the persist transaction is unchanged; only its location moves.

## Decision

We will keep **one physical database at a well-known user-level location** (`$XDG_CACHE_HOME/doist/todoist.db`, defaulting to `~/.cache/doist/todoist.db`) opened by every consumer, instead of one per repo. Repo `.doistrc` files remain read-time lenses over the shared store and are otherwise unchanged.

We deliberately do **not** add cross-process synchronization around syncing. Usage is a single developer running CLI commands and agent sessions; simultaneous syncs are too rare to justify lock machinery (staleness budgets, ownership tokens, stale-break races), all of which would be discarded anyway once doist-core moves behind a single-writer service. The bounded worst case when two syncs do overlap is a redundant API call or a re-fetched delta — SQLite's persist transaction plus ADR 0001's token atomicity keep the store consistent throughout. If real-world contention emerges first, the fix is accelerating the service migration, not client-side locking.

The database opens in **WAL mode** with a busy timeout, so concurrent readers never block on a writer's transaction.

## Consequences

**Positive:**

- One mirror, one quota burn, one self-healing full-sync cadence regardless of how many repos exist.
- Cross-repo reads see fresh data immediately (no per-repo staleness skew).
- Readers stay responsive during sync writes (WAL).
- Sync is a plain function call — no lock acquisition, wait budgets, or stale-lock recovery paths.

**Negative:**

- A corrupted central store affects every repo at once; recovery is one full re-sync.
- The first run after adopting the central store performs exactly one full sync to backfill it (the staleness budget sees no prior full sync).
- Two overlapping syncs both hit the Todoist API; one may waste its incremental fetch or need to re-fetch after losing the token race.

## Vocabulary

- **Central store**: the single user-level SQLite database all consumers open.
- **Lens**: the read-time project scoping derived from a repo's `.doistrc`.
