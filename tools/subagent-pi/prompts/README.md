# Workflow prompts

No workflow prompt templates are shipped here by design. The directory is intentionally README-only, and the decision to keep it empty is resolved and final.

Workflow orchestration belongs to the skills that already describe it:

- `code-review` defines its two-axis review.
- `codebase-design` defines its parallel design alternatives and comparison.
- `research` and `wayfinder` can direct background delegation through the `subagent` capability.

Adding slash-command wrappers would duplicate those instructions, create another discoverability surface, and fail to guarantee the required orchestration. The extension therefore provides the `subagent` tool, agent roster and aliases, persona overrides, and background command—not workflow templates.

The existing mise dotfiles entry deliberately maps `~/.pi/agent/prompts` to this directory. The wiring remains in place while the directory stays empty of templates.
