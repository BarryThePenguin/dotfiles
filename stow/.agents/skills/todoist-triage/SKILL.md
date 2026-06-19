---
name: todoist-triage
description: Deliberate Todoist cleanup session. Use when todoist-check-in redirects here (>5 overdue), when the system feels overwhelming, or when the user asks to "triage todoist", "clean up my tasks", or "the list is a mess". Does not process thoughts-label captures — that is todoist-process-inbox.
allowed-tools: mcp__doist__todoist_triage_analysis, mcp__doist__todoist_tasks_update, mcp__doist__todoist_tasks_complete, mcp__doist__todoist_tasks_move
---

# Todoist Triage

A deliberate cleanup session — not a check-in. Set expectations upfront: 10-20 minutes depending on backlog, and you don't have to finish everything in one session.

## Step 1 — Analyse

Call `todoist_triage_analysis` with `sync: true`.

*Completion: `result.duplicates`, `result.stale`, `result.unroutedInbox`, and `result.missingEnergyMetadata` in hand.*

## Step 2 — Present the situation

> **Triage summary:**
> - Duplicate groups: `result.duplicates.groups.length`
> - Stale tasks: `result.stale.candidates.length`
> - Unrouted inbox items: `result.unroutedInbox.length` *(excludes `thoughts`)*
> - Missing energy context: `result.missingEnergyMetadata.length`
>
> Where do you want to start?

If no preference, recommend the highest-count category. If unrouted inbox is non-zero, that's usually the most actionable starting point. Missing energy context is worth doing early — it makes future check-ins more useful.

## Step 3 — Work one category at a time

### Duplicates
For each group in `result.duplicates.groups`:
- Show the canonical task and its matches, linked: `[Task name](task.url)`
- Show the recommendation (merge / review / ignore) and the reason
- Ask: keep one and complete the rest, ignore, or handle manually?
- Queue the decision — don't apply yet

### Stale tasks
For each candidate in `result.stale.candidates`:
- Show task with project, linked: `[Task name](task.url)`
- Show the signals that flagged it and the recommendation
- Ask based on `recommendationCode`:
  - `reschedule` — task is overdue: pick a new date, or remove the date entirely?
  - `schedule` — task has no date: add a date, rewrite as a clearer action, or complete/drop?
  - `rewrite` — ask for new wording, or complete/drop?
  - `complete` — confirm completion, or keep if still relevant?
  - `keep` — show for awareness, no action needed
- Queue the decision

### Unrouted inbox
Tasks in Inbox without the `thoughts` label are captures that never got routed:
- Show each, linked: `[Task name](task.url)`
- For each: route to a project, rewrite as a clearer action, or complete it
- Queue the decision

### Missing energy context

Tasks with no priority and no energy label (`low-energy`, `medium-energy`, `high-energy`, `quick`) are invisible to the check-in's energy-based suggestions. For each:
- Show the task, linked: `[Task name](task.url)`
- Ask: assign an energy label (`low-energy` / `medium-energy` / `high-energy`), mark it `quick`, set a priority (1–3), or skip?
- Queue the update

If the list is long, do a batch: show all at once and let the user assign in one pass rather than one at a time.

**When a task gets `high-energy`:** pause and ask — *"This one needs real focus to start. Is it actually worth doing, or has it been sitting here because you're avoiding it?"* A task that keeps getting deferred probably isn't going to happen. Better to complete it now than let it haunt the list. Don't do this for every `high-energy` assignment — only when the task looks like it's been around a while or has been rescheduled.

If `thoughts`-label tasks appear during any category: skip them, note they belong in `todoist-process-inbox`.

### Pacing
After finishing a category: *"Want to keep going or stop here?"* Don't push. A partial triage is better than a forced one.

## Step 4 — Confirm and apply

Before any changes, show the full queue:

> **About to make N changes:**
> - Complete: [task](url), [task](url)
> - Move to Personal: [task](url)
> - Rewrite: [old name](url) → "new name"
> - Complete: [task](url)
>
> Confirm?

Apply only on explicit yes. Then execute all queued changes.

*Completion: all queued changes applied.*

## Step 5 — Reflection

One question after applying:

> *"What pattern kept coming up?"*

Don't analyse for them — just prompt and listen. Common signals worth naming: vague tasks that never get started, the same idea captured multiple times, tasks rescheduled so often they've lost meaning. These point to upstream capture or workflow problems, not just clutter.

---

## Anti-patterns

- Processing `thoughts` items — skip them, they have their own skill
- Applying changes before confirmation
- Continuing past the user's energy — check in after each category
- Turning the reflection into a new planning session
