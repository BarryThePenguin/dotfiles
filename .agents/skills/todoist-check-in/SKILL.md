---
name: todoist-check-in
description: Fast Todoist scan. Use when the user asks "check my todoist", "what can I do tonight?", "what's coming up?", or "what should I work on?".
allowed-tools: mcp__doist__todoist_session_summary, mcp__doist__todoist_tasks_update, mcp__doist__todoist_tasks_complete
---

# Todoist Check-in

A scan — quick read of what's due and what's possible. Goal: leave with 0-2 things to act on.

## Step 1 — Energy check

One question, three options:

> "How's your energy right now?"
> - **Low** — winding down, want easy wins or just a scan
> - **Medium** — can focus for an hour
> - **Have a block** — got real time, want something meaningful

## Step 2 — Fetch session summary

Call `todoist_session_summary` with `energy` set to the answer from Step 1 (`low`, `medium`, or `high`) and `sync: true`.

**If `result.requiresTriage` is true:** Say:
> *"You have N overdue tasks — the system needs a triage, not a scan. Run `todoist-triage` to clear the backlog."*
Then skip to Step 4. Don't proceed with the scan.

**Otherwise:** Present clearly and briefly:
- **Overdue** (`result.overdue`): list with project name, linked `[Task name](task.url)`.
- **Due today** (`result.today`): same format.
- **Nothing due:** say so plainly and continue to Step 3.

*Completion: due and overdue tasks surfaced, or user redirected to triage.*

## Step 3 — Surface 1-2 options

Use `result.suggested` from Step 2 as the starting point. Present as a short list, not a decision tree.

**Low energy:**
- Suggest tasks labelled `low-energy` or `quick`
- Or confirm nothing needs doing: *"Nothing urgent — enjoy your evening."* and stop.
- If `high-energy` tasks are due or overdue, acknowledge them briefly: *"You have N high-energy tasks due — best tackled fresh, not when winding down."* Don't list them. Don't push.

**Medium energy:**
- Suggest tasks labelled `low-energy`, `medium-energy`, or `quick`
- If `high-energy` tasks are due or overdue, same acknowledgement as low energy — medium energy isn't enough unless momentum has already built up in the session, which you can't know at the start

**Have a block:**
- Surface `high-energy` tasks first — this is when they're worth tackling
- If none are due, ask what they feel like working on and pull relevant tasks

If they say "none of these" or "not feeling it" — that's fine. Don't push.

*Completion: 1-2 options presented and user has responded.*

## Step 4 — Inbox note

Use `result.thoughtsCount` from Step 2 — no additional tool call needed.

If count > 0:
> *"You have N thoughts waiting in your inbox — review them when you have energy."*

If count is 0: skip entirely.

## Step 5 — Done

Scan complete. Done unless the user asks for something else.

---

## Anti-patterns

These will feed the procrastination loop. Avoid them:

- Starting a planning conversation ("let's think through your week...")
- Prompting to set due dates on tasks that aren't overdue
- Processing `thoughts` — acknowledge the count, move on
- Showing more than 5-6 tasks at once
- Asking follow-up questions after the user picks something to do
- Offering to reorganise projects or labels

---

## Project scoping note

`todoist_tasks_list` returns tasks for projects listed in the nearest `.doistrc`. If the scope is narrow, work with what's visible rather than flagging it as a problem.
