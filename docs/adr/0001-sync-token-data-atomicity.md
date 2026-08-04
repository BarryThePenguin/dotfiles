# ADR 0001: Sync Token and Data State Must Remain Atomic

**Status**: Accepted

**Date**: 2026-05-23

## Context

Todoist uses an incremental sync model where a sync token acts as a cursor. When we call `sync(token)`, we receive:

- All resources changed since the last sync
- A new token for the next sync
- A `"*"` token indicates a full sync

The database stores both the sync token and the synced data. These two pieces of state are tightly coupled: the token describes "what version of data do we have", and the data itself must match that description.

If they drift—e.g., data persists but token update fails (or vice versa)—the next sync will either re-fetch duplicate data or miss changes entirely. Recovering requires a full sync.

## Decision

We will ensure that sync token and data state always advance or stay the same together. Specifically:

1. **Sync-and-persist is atomic**: All data upserts + token update happen in a single database transaction. If any part fails, the entire transaction rolls back.

2. **Token update is idempotent**: `setSyncToken()` returns a boolean. If it fails (e.g., database contention), the operation is safe to retry without side effects.

3. **Reconciliation happens pre-write**: Before persisting any data, we detect conflicts and filter to allowed projects. We never persist partial or invalid data.

## Consequences

**Positive:**

- Invariant is easy to reason about: token and data are always in sync.
- Recovery from failures is simple: if sync fails mid-transaction, just retry. No orphaned state.
- Future architectural changes (e.g., read replicas, sharding) don't risk token/data drift.

**Negative:**

- Transactions must be fast enough to hold locks. Long-running sync payloads could cause contention.
- If the database is unavailable, we can't advance the token even if the sync succeeded. Next attempt will re-fetch the same data (safe, but wasteful).

## Rationale

Sync tokens are a form of **distributed consensus**. Drifting sync state is a class of subtle bugs (missing updates, duplicate inserts) that are hard to debug after the fact. Enforcing atomicity makes the contract explicit and limits options later, but prevents a whole category of bugs.

## Alternatives Considered

**Async token update (token advances separately after data write)**

- Pro: Allows non-blocking token persistence
- Con: Introduces a window where token and data drift. Requires reconciliation logic on restart.
- Rejected: Too much complexity for uncertain benefit.

**Per-resource versioning (each entity has its own token)**

- Pro: Granular control; could sync resources independently
- Con: Requires version vectors, makes conflict detection much harder
- Rejected: Over-engineered for our current use case.
