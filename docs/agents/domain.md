# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or **`CONTEXT-MAP.md`** if it exists. A
  context map points to one `CONTEXT.md` per bounded context; read the files
  relevant to the topic.
- **`docs/adr/`** — read system-wide ADRs that touch the area you're about to
  work in.
- In a multi-context layout, also read
  **`src/<context>/docs/adr/`** for ADRs scoped to the relevant context.

If any of these files do not exist, proceed silently. Do not flag their absence
or suggest creating them upfront. The `/domain-modeling` skill creates domain
docs lazily when terms or decisions actually get resolved.

## File structure

This repository is currently a single-context domain model:

```text
/
├── CONTEXT.md
├── docs/adr/                  ← system-wide architectural decisions
└── .agents/skills/            ← engineering skills
```

If the domain is later split into bounded contexts, use an explicit map rather
than making consumers guess which glossary applies:

```text
/
├── CONTEXT-MAP.md             ← points to each context's glossary
├── docs/adr/                  ← system-wide decisions
└── src/
    ├── <context-a>/
    │   ├── CONTEXT.md
    │   └── docs/adr/          ← context-specific decisions
    └── <context-b>/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When output names a domain concept — in an Issue title, refactor proposal,
hypothesis, or test name — use the term as defined in the relevant
`CONTEXT.md`. Do not drift to synonyms that the glossary explicitly avoids.

If the concept needed is not in the glossary, that is a signal: either the
project already has a term that should be used, or there is a real gap to take
to `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than
silently overriding it:

> _Contradicts ADR-0001 (the ADR title) — but worth reopening because…_
