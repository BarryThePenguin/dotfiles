# subagent-pi

A dotfiles-managed subagent capability for pi — a fork of pi's example subagent extension
(`examples/extensions/subagent`) adapted per the wayfinder **Subagents in pi** map.

A **subagent** = a separate `pi` process with an isolated context window. The `subagent`
tool delegates bounded work to one; agents are markdown personas in `agents/`.

## What's here

```
src/index.ts     Extension entry: subagent tool + /subagent-bg command + rendering
src/agents.ts    Agent discovery (forked: adds `thinking` frontmatter + alias surface)
src/personas.ts  .pi/personas.json override layer (tree-walk, canonical-keyed)
src/run.ts       Child spawning: sync json-mode children + detached RPC background child
agents/          The agent roster (user-level): general, explore
prompts/         Workflow prompt templates (auto-discovered as /name); see README
```

## Roster

| Agent    | Model             | Tools                          | Serves |
|----------|-------------------|--------------------------------|--------|
| `general`| deepseek-v4-pro   | read, grep, find, ls, bash, webfetch | review, research, design briefs (the minion) |
| `explore`| deepseek-v4-pro   | read, grep, find, ls (read-only)     | organic codebase exploration |

**Alias surface** (a naming contract with the skills — zero skill edits): `general-purpose` → `general`
(code-review), `Explore` → `explore` (improve-codebase-architecture, case-insensitive).

## Fork deltas vs the example

1. **Roster surfaced to the parent** — `promptSnippet` + `promptGuidelines` name every
   agent, so the parent model can pick organically instead of guessing.
2. **Alias surface** — agent names pass through `resolveAgentName`.
3. **Persona override layer** — project-local `.pi/personas.json` (`{ provider?, model?,
   thinkingLevel? }` keyed by canonical agent name) merges over `agents.md` frontmatter,
   discovered nearest-up from cwd. The child spawn passes `--provider` and `--thinking`
   when set; provider defaults to the parent session's provider.
4. **Background command** — `/subagent-bg [agent:<name>] <brief>` spawns a detached
   `pi --mode rpc` child (`--session-dir` for resumability); when it settles the final
   output is injected into the session via `sendUserMessage`, so the parent keeps working
   while the subagent reads (background/AFK research).

## Usage

```
Use the general subagent to review the diff
Run 2 explore subagents in parallel: one over src/, one over tests/
/subagent-bg agent:general Research pi's JSON mode against docs/json.md and write findings to docs/research/pi-json.md
```

## Persona overrides

```jsonc
// .pi/personas.json (project root — walked up from cwd)
{
  "general": { "provider": "gpt", "model": "gpt-5.5", "thinkingLevel": "high" }
}
```

Only `provider` / `model` / `thinkingLevel` are overridable; name, description, tools,
and system prompt stay in the dotfiles agents.

## Dotfiles wiring

`~/.pi/agent/extensions/subagent-pi` → `tools/subagent-pi` (extension)
`~/.pi/agent/agents` → `tools/subagent-pi/agents` (roster)
`~/.pi/agent/prompts` → `tools/subagent-pi/prompts` (workflow templates)

Managed by mise dotfiles entries in `.config/mise/config.toml`.
