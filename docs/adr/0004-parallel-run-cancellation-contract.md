# ADR 0004: Parallel Run Cancellation Contract

**Status**: Accepted

**Date**: 2026-08-26

## Context

`runParallelRun` (`tools/subagent-pi/src/parallel-run.ts`) schedules a bounded
collection of **Parallel run** tasks (see `CONTEXT.md`) across a worker pool
and accepts an `AbortSignal` to cancel the run. Today, cancellation behavior
is implicit in the implementation rather than a stated contract, which leaves
three things undefined for callers and for future changes to the engine:

1. What happens to tasks that haven't started yet (`queued`) when cancellation
   is requested?
2. What happens to a task that is mid-flight (`running`) — does its eventual
   result get kept, discarded, or does its status get overwritten?
3. What happens if a runner (the injected `ParallelTaskRunner`) does not
   respect the `AbortSignal` at all and never settles?

Two follow-on tickets — "Harden Parallel run snapshots and result reporting"
and "Make Parallel run cancellation robust" — depend on this contract being
explicit before they can be scoped or tested.

The one concrete runner in production, `runSingleAgent` (`run.ts`), already
implements process-level forced cancellation: on abort it sends `SIGTERM` to
the child, then `SIGKILL` after a 5s grace period if the process hasn't
exited, and the task's promise rejects once the process closes. That
behavior is a property of this one runner, not a guarantee `runParallelRun`
makes about arbitrary runners.

## Decision

Cancellation is **cooperative at the engine level, with process-level forced
enforcement left to the runner**. Concretely:

1. **Queued tasks** that have not been picked up by a worker transition
   directly to `cancelled` the moment cancellation is requested (via
   `AbortSignal.abort()` or `signal.aborted` already being `true`). They never
   start and never produce a result.

2. **Running tasks**: `runParallelRun` does not forcibly interrupt a running
   task itself — cancellation is signalled via the same `AbortSignal` the
   runner receives, and the engine waits for that task's promise to settle.
   When it does settle after cancellation was requested:
   - The task's own outcome (success or thrown error) is **discarded** — its
     final status is always `cancelled`, never `completed` or `failed`,
     regardless of what the runner returned or threw.
   - The **last partial result reported via `onUpdate` before cancellation**
     is retained on the entry and still rendered (e.g. `execute.ts`'s
     `formatParallelProgress`/summary text uses whatever `entry.result` holds).
     Only the discarded final outcome is dropped, not prior progress.
   - A task that had **already reached a terminal status** (`completed` /
     `failed`) before the abort signal fired keeps that status —
     cancellation never retroactively overwrites an already-settled task.

3. **A runner that ignores the `AbortSignal` and never settles** blocks that
   worker slot, and therefore the whole run's `Promise.all`, indefinitely.
   `runParallelRun` does not impose an engine-level deadline of its own — it
   delegates "forced enforcement within a bounded time" entirely to the
   runner. `runSingleAgent` fulfills this today via its
   `SIGTERM` → `SIGKILL` (5s) process-kill path. Any other runner passed to
   `runParallelRun` is **required** to honor the same bound (terminate or
   reject within a bounded, short grace period of the signal firing) or the
   batch can hang. Closing that gap generically — an engine-level watchdog
   that force-settles a task if the runner itself never honors the signal in
   time — is explicitly **out of scope here** and is the subject of "Make
   Parallel run cancellation robust" and the per-task watchdog ticket.

In short: **cooperative signal + runner-owned forced fallback**, not a
timeout owned by the engine. This matches what's already implemented for the
one production runner and gives the follow-on tickets a fixed target instead
of an implicit one.

## Consequences

**Positive:**

- Callers (e.g. `execute.ts`'s parallel-mode summary) can rely on a single
  rule: `cancelled` means "requested and not counted as a real outcome",
  independent of timing races between the abort firing and a task settling.
- `runSingleAgent`'s existing kill behavior needs no change to satisfy this
  contract.
- The remaining gap (a non-cooperative custom runner) is named and scoped
  to specific follow-on tickets instead of being an unstated bug.

**Negative:**

- `runParallelRun` itself offers no engine-level protection against a hung
  runner; a badly-behaved `ParallelTaskRunner` can still stall a batch
  forever until the watchdog ticket lands.
- Discarding a running task's actual final result on cancellation means a
  task that was about to succeed just as cancellation fired reports no
  final output — only whatever partial progress preceded it.

## Alternatives Considered

**Engine-owned timeout (`runParallelRun` force-settles any task after a fixed
duration post-abort, independent of the runner)**

- Pro: guarantees the run always settles within a bounded time, regardless
  of runner behavior.
- Con: `runParallelRun` would need to kill/abandon work it doesn't own
  (it only holds a `Promise`, not a process handle), so "force-settle" would
  mean discarding the in-flight promise without actually stopping the
  runner's side effects — a partial fix that still leaves the runner running.
- Rejected here: the process-owning runner is the right place to enforce a
  bound (it can actually kill something); a generic engine-level watchdog is
  still worth adding as a safety net, but as a distinct, separately-scoped
  change (tracked in the watchdog ticket), not folded into this contract.

**Preserve a cancelled task's final result if it succeeded**

- Pro: no wasted work if a task finishes "successfully" microseconds after
  cancellation was requested.
- Con: makes `cancelled` an ambiguous status (sometimes has a real result,
  sometimes doesn't), and requires re-checking cancellation state at the
  point the caller reads the result rather than at settlement time.
- Rejected: a single unambiguous meaning for `cancelled` (requested, outcome
  not authoritative) is simpler to reason about and test.
