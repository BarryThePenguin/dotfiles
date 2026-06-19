---
name: todoist-process-inbox
description: Clarify captured thoughts into routed tasks or discard them. Use when the user wants to process their inbox or says "process my thoughts" / "clear my inbox".
allowed-tools: mcp__doist__todoist_tasks_list, mcp__doist__todoist_tasks_update, mcp__doist__todoist_tasks_complete, mcp__doist__todoist_tasks_move, mcp__doist__todoist_projects_discover
---

# Todoist Process Inbox

**Clarify** each captured thought into one outcome — route it, rewrite it, or discard it. This takes genuine focus. Do not run at low energy.

## Step 1 — Fetch

Call `todoist_tasks_list` with `label: "thoughts"`, `details: true`, and `sync: true`.

If the list is empty: say so and stop.

*Completion: you have the full list of thought-labelled tasks.*

## Step 2 — Clarify one at a time

Present tasks one at a time. For each, show the task name linked to its Todoist URL and its current project. Ask: **what is this?**

| What it is | Action |
|---|---|
| Clear next step | Route to right project, remove `thoughts` label |
| Vague ("look into X", "do something about Y") | **Rewrite** into a specific action first, then route |
| Idea / someday | Move to Personal, remove `thoughts` label |
| Not worth keeping | Complete (discard) |

**Rewriting:** push back if the rewritten version is still vague. "Look into X" → "Find out [specific question] about X". "Sort out Y" → "[Verb] Y by [doing what]". One round of pushback is enough — if they can't clarify it, park it in Personal.

**Dates:** don't set a due date unless the user names a specific time they'll do it. Leave tasks undated — a floating task is honest. A placeholder date just creates overdue noise in every check-in until triage cleans it up.

*Completion: every thought has been assigned an outcome. None undecided.*

## Step 3 — Confirm and apply

Summarise before touching anything:
- N updated (N rewritten), destinations listed
- N completed (discarded)

Get confirmation, then apply. Use `todoist_tasks_complete` for discards, `todoist_tasks_update` / `todoist_tasks_move` for the rest.

*Completion: `thoughts` label removed from all processed tasks, discards completed.*

## Step 4 — Done

One line: how many processed, how many discarded. Stop.
