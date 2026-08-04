# Workflow prompts

Workflow prompt templates live here: each `*.md` is auto-discovered by pi as a `/name` slash command (a thin natural-language shim chaining agents via the `subagent` tool).

**This directory is intentionally empty of templates right now.** The concrete set (`/review-2axis`, `/research`, `/design-twice`, …) is decided by the *Workflow prompt set* ticket on the wayfinder "Subagents in pi" map — an open decision, not yet resolved. Add templates here once that decision lands; no extension change or re-wiring is needed, pi discovers them automatically.

Template anatomy (pi prompt template):

```markdown
---
description: One line, shown in slash-command completions
---

<natural-language instructions chaining agents by name via the subagent tool>
```
