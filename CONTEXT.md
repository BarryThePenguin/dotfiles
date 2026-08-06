# Dotfiles

A personal dotfiles monorepo managed with mise, and the home of this machine's engineering agent skills. The domain terms below follow the upstream [mattpocock/skills](https://github.com/mattpocock/skills) model — this repo's skills are a vendored, extended copy of that collection.

## Language

**Issue tracker**:
The tool that hosts a repo's issues — for this repo, Todoist or local markdown, selected per repo by the tooling (a repo's `.doistrc` selects Todoist; a `.scratch/` directory selects local). The skills are **issue-tracker agnostic**: they call the shared `wayfinder_*` and `issue_*` tool surfaces and never need to know which tracker is active.
_Avoid_: backlog manager, backlog backend, issue host

**Parallel run**:
A single subagent request that schedules multiple agent tasks with bounded concurrency and produces ordered per-task outcomes. Each task may be queued, running, completed, failed, or cancelled; the run reports progress without changing the meaning of a settled agent result.
_Avoid_: batch job, worker pool

**Tracker session**:
The lifetime of one interaction context with a selected **Issue tracker**. It shares one tracker selection and one local view of Issues; a new session starts with a new selection and view.

**Project** (Todoist only):
The Todoist container that scopes an **Issue** to a repo — one project per repo, loosely mirroring a GitHub repo. A repo's issues (wayfinder and generic alike) live in its project. A repo declares its project(s) in its own `.doistrc`; the Wayfinder extension writes to the first listed project. The `dotfiles` repo has its own project (id `6h9Wxp68J6HrG99m`), first in its `.doistrc`. This repo's `.doistrc` is shared with the personal-task MCP tooling, which scans every listed project. The local tracker has no projects: the repo itself is the scope.

**Inbox** (Todoist only):
Todoist's default catch-all project — the capture tray where un-routed captures land, and where this repo's wayfinder tickets landed before the Dotfiles project existed. It behaves like a project but is not a repo scope; it is not a home for **Issues**.

**Issue**:
A single tracked unit of work inside an **Issue tracker** — a bug, task, spec, or slice produced by `to-tickets`.
_Avoid_: ticket (use only when quoting external systems that call them tickets, or for a **Decision ticket** — see below)

**Decision ticket**:
A `wayfinder` unit — a child **Issue** of a `wayfinder:map` holding a _question_ whose resolution is a decision, not a slice of a build to execute. The **decision** qualifier is what keeps it distinct from an implementation ticket; `wayfinder` introduces the term, then uses "ticket". A Decision ticket is an Issue with a `wayfinder:<type>` label; a ticket is _claimed_ by assigning it to the dev driving the map (a `Claimed by:` header on both trackers), _resolved_ by posting a resolution comment, and _closed_ via the generic Issue lifecycle. On the local tracker the ticket file's `Status:` line is its lifecycle (`open` | `resolved`) — a different meaning from a generic Issue file's `Status:` line, which renders its labels.

**Resolution**:
The answer to a **Decision ticket** — a **comment** on the ticket, never a separate field. Resolving a Decision ticket is one workflow with a single outcome: it records the canonical Resolution, closes the ticket, appends the decision to its **Wayfinder map**, and reports newly-unblocked tickets. The Resolution is the first comment the workflow records — it wins, and later attempts to record a Resolution are ignored. Ordinary comments remain allowed after closure. A closed Decision ticket without a Resolution is incomplete and requires human inspection. Resolution and closed status are distinct facts, though a tracker adapter may persist them together — the recording is tracker-native: on the local tracker the Resolution renders as the `## Answer` section; on Todoist it is a native task comment. "Resolved" is the **closed** lifecycle state, not a third status.

**Spec**:
An **Issue** whose body follows the `to-spec` template (Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes).

**Triage role**:
A canonical state-machine role applied to an **Issue** during triage. Five **state** roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) are the recorded axis: a triaged issue carries exactly one state role, recorded tracker-specifically — a Todoist label or a local `Status:` line on a generic Issue file (that file's labels line) — behind the tool surface; `docs/agents/triage-labels.md` maps role to the concrete strings. Two **category** roles (`bug`, `enhancement`) are classification vocabulary, not recorded state: they surface in the triage recommendation, the agent brief (`Category:` line), and rejection routing (an enhancement `wontfix` writes `.out-of-scope/`), never as a tracker field.

**Wayfinder map**:
An **Issue** labelled `wayfinder:map` whose child issues are **Decision tickets**. The map holds the effort's destination, notes, decisions-so-far, and fog — it is an index that gists and links its tickets, never restating them. A decision is identified by its linked Decision ticket's id/URL; the first entry wins, and later entries are ignored. While no entry exists, a retry may supply the gist; once the first entry is written, its gist is immutable. A decision enters the map only after its Decision ticket has a Resolution and closed status.

**Frontier**:
The **Decision tickets** on a **Wayfinder map** that are ready to work — open, unclaimed, with every blocking ticket closed. The remaining open tickets are _claimed_ (assigned to the dev driving the map) or _blocked_ (held by at least one open ticket — always another **Decision ticket** on the same **Wayfinder map**). The full treatment lives in the `/wayfinder` skill ("the edge of the known"); this entry pins the vocabulary the tool surface and domain module use.
_Avoid_: backlog, ready queue

## Relationships

- An **Issue tracker** holds many **Issues**
- A **Tracker session** works with one selected **Issue tracker** and one local view of its Issues
- The skills are **issue-tracker agnostic** — they call the tool surface, never an **Issue tracker** directly
- A **Project** (Todoist) scopes an **Issue** to a repo (loose one-to-one with a GitHub repo); a repo's `.doistrc` declares its **Projects**, and the Wayfinder extension writes to the first listed
- An **Issue** on Todoist is expressed as a task in the repo's **Project**
- An **Issue** carries one **Triage role** (state) at a time; the category is classification vocabulary, not a recorded axis
- A **Decision ticket** is an **Issue** (a child of a `wayfinder:map`) — claimed by assigning it to the dev driving the map, resolved via a resolution comment, closed via the generic lifecycle
- A **Spec** is an **Issue**
- A **Wayfinder map** is an **Issue**
- A **Wayfinder map** and its **Decision tickets** are ordinary Issues to the generic surface — discriminated only by `wayfinder:` labels, one id space (Todoist task ids / local `<map>/NN-slug`), no separate resource kind
- A **Frontier** is a set of **Decision tickets** on a **Wayfinder map** — the open, unclaimed, unblocked ones; its complements are the claimed and the blocked
